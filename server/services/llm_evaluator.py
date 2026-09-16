import os
import re
import json
import time
import logging
from typing import Optional, Dict, Any, List
import httpx

from schemas.ocr import OCRScanResult, TextBlock, BBox
from schemas.compliance import (
    ComplianceResult,
    ComplianceSummary,
    DeclarationFound,
    DeclarationMissing,
    ViolationDetail,
    StructuredComplianceResult,
)
from schemas.llm_compliance import LLMRuleEvaluation, LLMComplianceResponse
from services.rag.citation_service import get_citation_service

logger = logging.getLogger("llm_evaluator")


def normalize_for_grounding(text: str) -> str:
    """Strips punctuation, extra spaces, and lowercases text for fuzzy grounding match."""
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", " ", text or "").lower()
    return " ".join(cleaned.split())


def verify_grounding(exact_quote: Optional[str], raw_text: str) -> bool:
    """
    Verifies that the LLM's cited exact_quote actually exists in the OCR text.
    Prevents hallucinations from fabricating declarations not present on packaging.
    """
    if not exact_quote or not exact_quote.strip():
        return False

    norm_quote = normalize_for_grounding(exact_quote)
    norm_doc = normalize_for_grounding(raw_text)

    if not norm_quote:
        return False

    # Exact substring check
    if norm_quote in norm_doc:
        return True

    # Despaced substring check (for glued OCR tokens like Rs250 or 100g)
    despaced_quote = norm_quote.replace(" ", "")
    despaced_doc = norm_doc.replace(" ", "")
    if despaced_quote in despaced_doc:
        return True

    # Word-level overlap: if >= 75% of quote words appear in document
    words = norm_quote.split()
    if len(words) >= 3:
        matches = sum(1 for w in words if w in norm_doc)
        if matches / len(words) >= 0.75:
            return True

    return False


def find_matching_bbox(exact_quote: Optional[str], text_blocks: List[TextBlock]) -> Optional[BBox]:
    """Finds the bounding box of the OCR text block that best matches the exact_quote."""
    if not exact_quote or not text_blocks:
        return None

    norm_quote = normalize_for_grounding(exact_quote)
    best_match_bbox = None
    best_score = 0.0

    for block in text_blocks:
        norm_block = normalize_for_grounding(block.text)
        if norm_quote in norm_block or norm_block in norm_quote:
            return block.bbox

        # Token overlap score
        q_words = set(norm_quote.split())
        b_words = set(norm_block.split())
        if q_words and b_words:
            overlap = len(q_words & b_words) / float(len(q_words))
            if overlap > best_score and overlap >= 0.5:
                best_score = overlap
                best_match_bbox = block.bbox

    return best_match_bbox


class LLMComplianceEvaluator:
    def __init__(self):
        # Support Groq API key directly or generic LLM_API_KEY
        self.api_key = (
            os.environ.get("GROQ_API_KEY")
            or os.environ.get("LLM_API_KEY")
            or ""
        )
        # Require explicit LLM_BACKEND="groq" or "ollama" to activate remote LLM evaluation;
        # otherwise use the high-speed deterministic compliance engine with statutory citations.
        self.backend = os.environ.get("LLM_BACKEND", "none").strip().lower()

        # Groq OpenAI-compatible endpoint
        self.base_url = (
            os.environ.get("GROQ_BASE_URL")
            or os.environ.get("LLM_BASE_URL")
            or "https://api.groq.com/openai/v1"
        ).rstrip("/")

        # Model defaults to Qwen or user override
        self.model = (
            os.environ.get("GROQ_MODEL")
            or os.environ.get("LLM_MODEL")
            or "qwen-2.5-32b"
        )
        self.timeout = float(os.environ.get("LLM_TIMEOUT_SECONDS", "15.0"))

    def is_available(self) -> bool:
        """Returns True if LLM backend is configured with a valid API key."""
        if self.backend in ("none", "", "disabled"):
            return False
        if not self.api_key:
            return False
        return True

    def _build_prompt(self, ocr_result: OCRScanResult, category: str, ruleset: Dict[str, Any]) -> tuple[str, str]:
        system_prompt = (
            "You are an expert Legal Metrology Compliance Inspector for packaged commodities in India.\n"
            "Evaluate the provided OCR label text against India's Legal Metrology (Packaged Commodities) Rules, 2011 "
            "and applicable category-specific regulations.\n\n"
            "CRITICAL RULES:\n"
            "1. Evaluate based ONLY on verbatim text from OCR scan.\n"
            "2. For every rule marked 'PASS', copy the exact verbatim text into 'exact_quote'. Do NOT invent text.\n"
            "3. If a mandatory declaration is missing, mark status='FAIL', violation_type='missing', exact_quote=null.\n"
            "4. Net Quantity must strictly use standard SI metric units ('g', 'kg', 'ml', 'L', 'N'). If non-standard symbols ('gms', 'gm', 'ltrs', 'kgs') are used, mark status='FAIL', violation_type='wrong_format'.\n"
            "5. If exempt (e.g. food packages <= 10g exempt from nutritional info), mark status='EXEMPT'.\n"
            "6. Keep 'explanation' extremely concise (maximum 10-15 words).\n"
            "7. Return ONLY a valid JSON object matching the requested schema without any markdown formatting.\n\n"
            "JSON Schema:\n"
            "{\n"
            '  "category": "string",\n'
            '  "overall_result": "PASS" | "FAIL",\n'
            '  "compliance_score": number (0-100),\n'
            '  "summary": "concise inspection summary",\n'
            '  "evaluations": [\n'
            '    {\n'
            '      "rule_id": "string",\n'
            '      "status": "PASS" | "FAIL" | "EXEMPT",\n'
            '      "extracted_value": "parsed value string or null",\n'
            '      "exact_quote": "exact verbatim substring from OCR text or null",\n'
            '      "violation_type": "missing" | "wrong_format" | "too_small" | null,\n'
            '      "severity": "CRITICAL" | "MAJOR" | "MINOR" | null,\n'
            '      "explanation": "rationale for finding"\n'
            '    }\n'
            '  ]\n'
            "}"
        )

        mandatory_rules = ruleset.get("mandatory_declarations", [])
        rules_desc = []
        for r in mandatory_rules:
            rules_desc.append(
                f"- Rule ID: '{r['id']}' | Name: '{r['field_name']}' | Required Format: {r.get('expected_format', '')}"
            )

        exemptions = ruleset.get("exemptions", [])
        exempt_desc = []
        for ex in exemptions:
            exempt_desc.append(f"- Exemption for '{ex.get('rule_id')}': {ex.get('description', '')}")

        user_content = (
            f"Product Category: {category}\n\n"
            f"Mandatory Rules to Evaluate:\n" + "\n".join(rules_desc) + "\n\n"
        )
        if exempt_desc:
            user_content += "Statutory Exemptions:\n" + "\n".join(exempt_desc) + "\n\n"

        user_content += (
            f"OCR Extracted Packaging Text:\n"
            f"'''\n{ocr_result.raw_text}\n'''\n\n"
            "Perform legal metrology compliance assessment and output JSON."
        )

        return system_prompt, user_content

    def evaluate_with_llm(
        self,
        ocr_result: OCRScanResult,
        category: str,
        ruleset: Dict[str, Any]
    ) -> Optional[ComplianceResult]:
        """
        Runs direct LLM compliance evaluation via Groq with anti-hallucination grounding.
        Returns ComplianceResult if successful, or None to fall back to the deterministic regex engine.
        """
        if not self.is_available():
            return None

        start_time = time.time()
        system_prompt, user_content = self._build_prompt(ocr_result, category, ruleset)

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
            "max_tokens": 800
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload
                )
                # Rate limit retry with 3.5s backoff if 429 occurs
                if resp.status_code == 429:
                    logger.warning("Groq rate limit (429) encountered. Pausing 3.5s before retry...")
                    time.sleep(3.5)
                    resp = client.post(
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json=payload
                    )

            if resp.status_code != 200:
                logger.warning(
                    "Groq LLM evaluation returned status %d: %s. Falling back to deterministic engine.",
                    resp.status_code,
                    resp.text[:200]
                )
                return None

            data = resp.json()
            raw_response_text = data["choices"][0]["message"]["content"].strip()
            # Clean markdown JSON block formatting if present
            if raw_response_text.startswith("```"):
                raw_response_text = re.sub(r"^```(?:json)?\s*", "", raw_response_text)
                raw_response_text = re.sub(r"\s*```$", "", raw_response_text)

            parsed = json.loads(raw_response_text)
            llm_resp = LLMComplianceResponse(**parsed)

            # Grounding verification, citation attachment, and ComplianceResult mapping
            citation_svc = get_citation_service()
            rule_map = {r["id"]: r for r in ruleset.get("mandatory_declarations", [])}
            found_declarations: List[DeclarationFound] = []
            missing_declarations: List[DeclarationMissing] = []
            violations: List[ViolationDetail] = []

            for ev in llm_resp.evaluations:
                rid = ev.rule_id
                rule_meta = rule_map.get(rid, {"field_name": rid})
                field_name = rule_meta.get("field_name", rid)
                citation = citation_svc.get_citation(rid)

                # Anti-hallucination verification
                if ev.status == "PASS" and ev.exact_quote:
                    is_grounded = verify_grounding(ev.exact_quote, ocr_result.raw_text)
                    ev.grounded = is_grounded
                    if not is_grounded:
                        logger.warning(
                            "LLM claimed rule '%s' PASS but exact_quote '%s' was NOT grounded in OCR text. Downgrading to FAIL.",
                            rid,
                            ev.exact_quote
                        )
                        ev.status = "FAIL"
                        ev.violation_type = "missing"
                        ev.severity = "CRITICAL"
                        ev.explanation = f"Declaration was not verifiable in actual label text ({ev.explanation})"

                bbox = find_matching_bbox(ev.exact_quote, ocr_result.text_blocks) or BBox(
                    x_min=0, y_min=0, x_max=0, y_max=0
                )

                if ev.status == "PASS":
                    found_declarations.append(
                        DeclarationFound(
                            id=rid,
                            field_name=field_name,
                            extracted_text=ev.exact_quote or ev.extracted_value or "",
                            parsed_value=ev.extracted_value,
                            confidence=0.95,
                            bbox=bbox,
                            font_size_px=20.0,
                            font_size_mm_est=2.0,
                            format_valid=True,
                            size_valid=True,
                            status="COMPLIANT",
                            citation=citation
                        )
                    )
                elif ev.status == "EXEMPT":
                    pass
                else:
                    # FAIL
                    if ev.violation_type == "missing":
                        missing_declarations.append(
                            DeclarationMissing(
                                id=rid,
                                field_name=field_name,
                                description=rule_meta.get("description", ""),
                                required=rule_meta.get("required", True),
                                citation=citation
                            )
                        )
                    violations.append(
                        ViolationDetail(
                            id=f"viol_llm_{rid}_{int(time.time())}",
                            rule_id=rid,
                            field_name=field_name,
                            violation_type=ev.violation_type or "missing",
                            severity=ev.severity or "CRITICAL",
                            description=ev.explanation,
                            evidence_bbox=bbox if (bbox.x_max > 0) else None,
                            citation=citation
                        )
                    )

            total_required = len(rule_map)
            total_found_valid = len(found_declarations)
            overall_result = "PASS" if (len(violations) == 0 and len(missing_declarations) == 0) else "FAIL"
            score = llm_resp.compliance_score if llm_resp.compliance_score is not None else (
                round((total_found_valid / max(total_required, 1)) * 100.0, 1)
            )
            processing_time = round((time.time() - start_time) * 1000, 2)

            summary = ComplianceSummary(
                what_was_found=found_declarations,
                whats_missing=missing_declarations,
                whats_wrong=violations
            )

            structured_result = StructuredComplianceResult(
                compliance_score=score,
                extracted_declarations=[
                    {
                        "field": item.field_name,
                        "value": item.extracted_text,
                        "status": item.status,
                        "confidence": item.confidence,
                        "citation": item.citation.model_dump() if item.citation else None,
                    }
                    for item in found_declarations
                ],
                violation_list=[
                    {
                        "rule_id": item.rule_id,
                        "severity": item.severity,
                        "description": item.description,
                        "field_name": item.field_name,
                        "violation_type": item.violation_type,
                        "citation": item.citation.model_dump() if item.citation else None,
                    }
                    for item in violations
                ],
                final_status="COMPLIANT" if overall_result == "PASS" else "NON_COMPLIANT"
            )

            return ComplianceResult(
                overall_result=overall_result,
                compliance_score=score,
                total_declarations_required=total_required,
                total_found=total_found_valid,
                summary=summary,
                processing_time_ms=processing_time,
                annotated_image_base64=ocr_result.annotated_image_base64,
                structured_result=structured_result
            )

        except Exception as e:
            logger.error("Groq LLM evaluation encountered exception: %s. Falling back to regex.", e)
            return None


# Module singleton
_llm_evaluator_instance: Optional[LLMComplianceEvaluator] = None

def get_llm_evaluator() -> LLMComplianceEvaluator:
    global _llm_evaluator_instance
    if _llm_evaluator_instance is None:
        _llm_evaluator_instance = LLMComplianceEvaluator()
    return _llm_evaluator_instance
