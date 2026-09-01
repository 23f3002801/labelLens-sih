import re
import time
import logging
from typing import List, Dict, Any, Optional

from schemas.ocr import OCRScanResult, TextBlock, BBox
from schemas.compliance import (
    ComplianceResult,
    ComplianceSummary,
    DeclarationFound,
    DeclarationMissing,
    ViolationDetail
)
from services.rule_loader import get_rules_from_db

logger = logging.getLogger("compliance_evaluator")


# --- Text Normalization -------------------------------------------------------------
# RapidOCR emits one text block per detected LINE, so a declaration printed across two
# lines ("MRP Rs 120 (Incl." + "of all taxes)") arrives as two separate blocks and is
# glued back together with "\n" inside raw_text. A plain substring search - against the
# per-line text OR against newline-joined raw text - therefore misses every wrapped
# phrase and reports a false "wrong_format". Every phrase check below runs on flattened,
# punctuation-folded text instead.

_UNICODE_FOLD = {
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "−": "-", " ": " ",
    "．": ".", "，": ",",
}


def flatten_text(text: str) -> str:
    """Uppercases, folds unicode lookalikes, and collapses every run of whitespace
    (newlines included) into a single space. Punctuation is preserved, so this is the
    form to use for numeric/format checks."""
    if not text:
        return ""
    for src, dst in _UNICODE_FOLD.items():
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip().upper()


def normalize_phrase(text: str) -> str:
    """flatten_text() plus punctuation folding: every non-alphanumeric character becomes
    a single space, so 'Incl.of all taxes', 'INCL . OF ALL TAXES' and '(inclusive of all
    taxes)' all reduce to the same token sequence."""
    flat = flatten_text(text)
    return re.sub(r"[^A-Z0-9]+", " ", flat).strip()


def despace(norm: str) -> str:
    """normalize_phrase() output with every space removed. RapidOCR regularly returns a
    whole declaration as one unbroken token - 'MRPRS250.00(INCL.OFALLTAXES)',
    'NETQTY:440g' - because tightly-set label text gives it no gaps to split on. Word
    boundaries cannot see into a token like that, so keyword tests fall back to this."""
    return norm.replace(" ", "")


# Keywords too short or too common to test as bare substrings: each one hides inside an
# ordinary word ('RS' in CUSTOMERS, 'INC' in PRINCE, 'UNIT' in UNITED, 'WORKS' in
# NETWORKS), so those stay word-boundary-only.
_SUBSTRING_UNSAFE_KEYWORDS = {"RS", "INC", "LTD", "UNIT", "WORKS", "ORIGIN", "CORP", "LLP", "N"}


def _has_keyword(norm: str, keywords: List[str]) -> bool:
    """Word-boundary keyword test on normalize_phrase() output, with a despaced substring
    fallback for keywords distinctive enough to be safe. Pure substring matching fires on
    the wrong words - 'RS' inside CUSTOMERS, 'WORKS' inside NETWORKS - while pure
    word-boundary matching misses every glued OCR token; this covers both."""
    flat_norm = despace(norm)
    for keyword in keywords:
        if re.search(r"" + re.escape(keyword) + r"", norm):
            return True
        flat_keyword = despace(keyword)
        if (
            len(flat_keyword) >= 3
            and flat_keyword not in _SUBSTRING_UNSAFE_KEYWORDS
            and flat_keyword in flat_norm
        ):
            return True
    return False


# Tolerant matcher for the Rule 6 tax clause. It runs on normalize_phrase() output, so it
# only has to cope with token variants and not with punctuation, casing or line breaks:
# INCL / INCL. / INCLUSIVE / INCLUDING, optional OF, optional ALL, TAX / TAXES. The tokens
# must still appear in sequence, so a stray "TAX" somewhere on the label never passes.
_TAX_CLAUSE_RE = re.compile(r"\bINCL(?:U(?:SIVE|DING|DES))?\b(?:\s+OF)?(?:\s+ALL)?\s+TAX(?:ES)?\b")
# Same clause after despace(), for the glued "(INCL.OFALLTAXES)" spelling. Still anchored
# on INCL...TAX in sequence, so an unrelated "TAX" elsewhere on the label never passes.
_TAX_CLAUSE_DESPACED_RE = re.compile(r"INCL(?:U(?:SIVE|DING|DES))?(?:OF)?(?:ALL)?TAX(?:ES)?")


def has_tax_clause(norm: str) -> bool:
    return bool(_TAX_CLAUSE_RE.search(norm) or _TAX_CLAUSE_DESPACED_RE.search(despace(norm)))


# Currency token as a WORD (plus the glued "Rs250" spelling OCR often produces).
_CURRENCY_RE = re.compile(r"₹|\bINR\b|\bRS\b|\bRS(?=[.\d])")

_QUANTITY_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(G|KG|ML|L|N|GM|GMS|LTRS)\b")
# Deliberately restricted to '/' and '-' separators: allowing '.' would make the price
# "50.00" read as a date.
_DATE_RE = re.compile(r"\b\d{2}[/\-]\d{2,4}\b")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(r"\b(1800|1860|\d{3,4}[\-\s]?\d{6,8})\b")
# Indian pincodes never start with 0 and are never part of a longer digit run.
_PINCODE_RE = re.compile(r"(?<!\d)[1-9]\d{5}(?!\d)")
# Six-digit numbers that are plainly not pincodes.
_NON_PINCODE_CONTEXT_RE = re.compile(r"\b(BATCH|BATCH NO|LOT|LOT NO|BARCODE|EAN|BAR CODE|B NO|L NO|GTIN)\b")

_MRP_KEYWORDS = ["MRP", "M R P", "MAXIMUM RETAIL PRICE", "MAX RETAIL PRICE"]
_NET_QTY_KEYWORDS = ["NET QTY", "NET WT", "NET WEIGHT", "NET CONTENT", "NET CONTENTS", "NET QUANTITY"]
_MFG_DATE_KEYWORDS = ["MFG", "MFD", "PKD", "MANUFACTURE", "MANUFACTURED ON", "PACKED", "BEST BEFORE", "USE BY", "EXP DATE", "EXPIRY"]
_MANUFACTURER_KEYWORDS = [
    "MFD BY", "MANUFACTURED BY", "PACKED BY", "PACKAGED BY", "MARKETED BY", "MKTD BY", "PRODUCED BY",
    "REGD OFFICE", "REGISTERED OFFICE", "WORKS", "FACTORY", "UNIT", "PVT LTD",
    "PRIVATE LIMITED", "LIMITED", "LTD", "LLP", "INC", "CORP", "INDUSTRIES", "ENTERPRISES",
]
_CONSUMER_CARE_KEYWORDS = ["CONSUMER", "CUSTOMER CARE", "FEEDBACK", "CALL US", "E MAIL", "EMAIL", "TOLL FREE", "HELPLINE"]
_COUNTRY_KEYWORDS = ["PRODUCT OF", "MADE IN", "COUNTRY OF ORIGIN", "ORIGIN"]


class ComplianceEvaluator:
    def __init__(self, ruleset: Optional[Dict[str, Any]] = None, db: Optional[Any] = None):
        if ruleset is None:
            ruleset = get_rules_from_db(db=db)
        self.ruleset = ruleset
        self.mandatory_rules = ruleset.get("mandatory_declarations", [])
        self.rule_map = {r["id"]: r for r in self.mandatory_rules}

    def _get_min_font_size(self, rule_id: str, default: float = 1.0) -> float:
        rule = self.rule_map.get(rule_id, {})
        val = rule.get("min_font_size_mm")
        if val is not None:
            try:
                return float(val)
            except (ValueError, TypeError):
                pass
        return default

    def evaluate(self, ocr_result: OCRScanResult) -> ComplianceResult:
        """
        Core "Brain" function for Task #6:
        - Takes OCR text blocks from Task #4
        - Matches text blocks to legal declaration entities
        - Runs Presence, Format, and Font Size checks
        - Returns structured result: what was found, missing, wrong, and overall PASS/FAIL.
        """
        start_time = time.time()
        
        found_declarations: List[DeclarationFound] = []
        missing_declarations: List[DeclarationMissing] = []
        violations: List[ViolationDetail] = []

        img_height = ocr_result.image_metadata.height
        blocks = ocr_result.text_blocks

        # Whole-label text, flattened to one line - this is what lets a phrase split
        # across two OCR blocks be matched at all.
        doc_norm = self._document_text(ocr_result)

        # (rule_id, detector, evaluator) - one source for both passes below, so the
        # primary classification and the fallback can never drift apart.
        matchers = [
            ("mrp", self._is_mrp, lambda b: self._eval_mrp(b, ocr_result, doc_norm)),
            ("net_quantity", self._is_net_quantity, lambda b: self._eval_net_quantity(b, img_height)),
            ("manufacture_date", self._is_mfg_date, lambda b: self._eval_mfg_date(b, img_height)),
            ("consumer_care", self._is_consumer_care, lambda b: self._eval_consumer_care(b, img_height)),
            ("manufacturer_details", self._is_manufacturer_details, lambda b: self._eval_manufacturer_details(b, img_height)),
            ("country_of_origin", self._is_country_of_origin, lambda b: self._eval_country_of_origin(b, img_height)),
        ]

        # rule_id -> [(score, DeclarationFound, [ViolationDetail])]. A single label
        # legitimately produces several matching blocks for the same rule (an MRP price
        # line plus its own "(incl. of all taxes)" line); emitting one DeclarationFound
        # per block duplicated the declaration AND its violations, and downstream
        # consumers key declarations by rule id, so the worst duplicate used to win.
        candidates: Dict[str, List[tuple]] = {}

        # Step 1: Analyze every OCR text block against Legal Metrology entity matchers.
        # First matcher wins, so a block still maps to at most one declaration type.
        for block in blocks:
            text = block.text.strip()
            for rule_id, detector, evaluator in matchers:
                if detector(text):
                    decl, viols = evaluator(block)
                    self._add_candidate(candidates, rule_id, block, decl, viols)
                    break

        # Step 1b: A block can claim only one declaration type, and a phrase can wrap onto
        # the next line - both leave a rule looking "missing" while its text sits right
        # there on the label (e.g. an address line that also carries the helpline number is
        # consumed by consumer_care, so manufacturer_details is falsely reported missing).
        # For every rule still unmatched, re-run just that rule's detector over each block
        # and over each block joined with the one after it.
        for rule_id, detector, evaluator in matchers:
            if rule_id in candidates:
                continue
            for idx, block in enumerate(blocks):
                text = block.text.strip()
                joined = f"{text} {blocks[idx + 1].text.strip()}" if idx + 1 < len(blocks) else text
                if detector(text) or detector(joined):
                    decl, viols = evaluator(block)
                    self._add_candidate(candidates, rule_id, block, decl, viols)

        # Step 1c: Keep exactly one declaration per rule id - the best-evidence block
        # (the one actually carrying the price/quantity/date, then the largest and most
        # confident) - and emit only that candidate's violations.
        for rule_id, entries in candidates.items():
            entries.sort(key=lambda entry: entry[0], reverse=True)
            _, decl, viols = entries[0]
            found_declarations.append(decl)
            violations.extend(viols)

        matched_rule_ids = set(candidates.keys())

        # Step 2: Check Presence for all mandatory declarations defined in active ruleset
        for rule in self.mandatory_rules:
            rule_id = rule["id"]
            is_required = rule.get("required", True)

            if rule_id not in matched_rule_ids and is_required:
                missing_decl = DeclarationMissing(
                    id=rule_id,
                    field_name=rule.get("field_name", rule_id),
                    description=rule.get("description", ""),
                    required=True
                )
                missing_declarations.append(missing_decl)

                viol = ViolationDetail(
                    id=f"viol_missing_{rule_id}_{int(time.time())}",
                    rule_id=rule_id,
                    field_name=rule.get("field_name", rule_id),
                    violation_type="missing",
                    severity="CRITICAL" if rule_id in ["mrp", "net_quantity"] else "MAJOR",
                    description=f"Mandatory declaration '{rule.get('field_name')}' is missing from product packaging.",
                    evidence_bbox=None
                )
                violations.append(viol)

        # Step 3: Compute Compliance Score and Overall PASS/FAIL Status
        total_required = sum(1 for r in self.mandatory_rules if r.get("required", True))
        total_found_valid = sum(1 for d in found_declarations if d.format_valid and d.size_valid)

        has_critical_or_major = any(v.severity in ["CRITICAL", "MAJOR"] for v in violations)
        overall_result = "FAIL" if has_critical_or_major else "PASS"

        # Deduct score per violation type
        score_deductions = 0.0
        for v in violations:
            if v.severity == "CRITICAL":
                score_deductions += 30.0
            elif v.severity == "MAJOR":
                score_deductions += 15.0
            else:
                score_deductions += 5.0

        compliance_score = max(round(100.0 - score_deductions, 1), 0.0)
        processing_time = round((time.time() - start_time) * 1000, 2)

        summary = ComplianceSummary(
            what_was_found=found_declarations,
            whats_missing=missing_declarations,
            whats_wrong=violations
        )

        structured_result = {
            "compliance_score": compliance_score,
            "extracted_declarations": [
                {
                    "field": item.field_name,
                    "value": item.extracted_text,
                    "status": item.status,
                    "confidence": item.confidence,
                }
                for item in found_declarations
            ],
            "violation_list": [
                {
                    "rule_id": item.rule_id,
                    "severity": item.severity,
                    "description": item.description,
                    "field_name": item.field_name,
                    "violation_type": item.violation_type,
                }
                for item in violations
            ],
            "final_status": "COMPLIANT" if overall_result == "PASS" else "NON_COMPLIANT",
        }

        return ComplianceResult(
            overall_result=overall_result,
            compliance_score=compliance_score,
            total_declarations_required=total_required,
            total_found=total_found_valid,
            summary=summary,
            processing_time_ms=processing_time,
            annotated_image_base64=ocr_result.annotated_image_base64,
            structured_result=structured_result,
        )

    # --- Text Assembly & Candidate Selection Helpers ---

    def _document_text(self, ocr_result: OCRScanResult) -> str:
        """Whole-label text as one normalized line. raw_text joins the OCR blocks with
        "\\n", so flattening it here is what allows a phrase that OCR split across two
        blocks/lines to still be matched."""
        raw = ocr_result.raw_text or ""
        if not raw.strip():
            raw = "\n".join(b.text for b in ocr_result.text_blocks)
        return normalize_phrase(raw)

    def _has_payload(self, rule_id: str, text: str) -> bool:
        """True when the block carries the declaration's actual value (the price, the
        quantity, the date) rather than only its wording. Used to pick which of several
        matching blocks represents the declaration."""
        flat = flatten_text(text)
        if rule_id == "mrp":
            return bool(re.search(r"\d", flat))
        if rule_id == "net_quantity":
            return bool(_QUANTITY_RE.search(flat))
        if rule_id == "manufacture_date":
            return bool(_DATE_RE.search(flat)) or bool(re.search(r"\d", flat))
        if rule_id == "consumer_care":
            return bool(_EMAIL_RE.search(text)) or bool(_PHONE_RE.search(flat))
        if rule_id == "manufacturer_details":
            return bool(_PINCODE_RE.search(flat)) or len(flat) > 20
        return True

    def _add_candidate(self, candidates: Dict[str, List[tuple]], rule_id: str, block: TextBlock,
                       decl: DeclarationFound, viols: List[ViolationDetail]) -> None:
        """Registers one possible block for a rule. Best evidence wins: value-carrying
        block first, then the largest font (the real declaration, not a footnote line),
        then OCR confidence, then text length."""
        score = (
            self._has_payload(rule_id, block.text),
            block.size.estimated_font_size_px,
            block.confidence,
            len(block.text),
        )
        candidates.setdefault(rule_id, []).append((score, decl, viols))

    # --- Entity Detection Helpers (Brand-Agnostic & Fully Generalized) ---

    def _is_mrp(self, text: str) -> bool:
        norm = normalize_phrase(text)
        if _has_keyword(norm, _MRP_KEYWORDS) or has_tax_clause(norm):
            return True
        # A bare price only counts as MRP when the currency token stands as its own word;
        # plain "RS" substring matching also fires on words like CUSTOMERS.
        flat = flatten_text(text)
        return bool(_CURRENCY_RE.search(flat)) and bool(re.search(r"\d", flat))

    def _is_net_quantity(self, text: str) -> bool:
        return _has_keyword(normalize_phrase(text), _NET_QTY_KEYWORDS) or bool(_QUANTITY_RE.search(flatten_text(text)))

    def _is_mfg_date(self, text: str) -> bool:
        return _has_keyword(normalize_phrase(text), _MFG_DATE_KEYWORDS) or bool(_DATE_RE.search(flatten_text(text)))

    def _is_manufacturer_details(self, text: str) -> bool:
        # Brand-agnostic manufacturer patterns: manufacturing verbs + corporate entity indicators + 6-digit pincode
        norm = normalize_phrase(text)
        return _has_keyword(norm, _MANUFACTURER_KEYWORDS) or self._looks_like_pincode(norm)

    def _looks_like_pincode(self, norm: str) -> bool:
        """A bare 6-digit number is far too loose to mean "address" on its own - batch
        codes, barcodes and lot numbers are 6 digits too. Require a plausible pincode
        (never leading zero, never inside a longer digit run), no batch/lot wording, and
        at least one real word alongside it, because an address is not just a number."""
        if not _PINCODE_RE.search(norm):
            return False
        if _NON_PINCODE_CONTEXT_RE.search(norm):
            return False
        return bool(re.search(r"[A-Z]{3,}", norm))

    def _is_consumer_care(self, text: str) -> bool:
        norm = normalize_phrase(text)
        is_email = bool(_EMAIL_RE.search(text))
        is_phone = bool(_PHONE_RE.search(flatten_text(text)))
        return _has_keyword(norm, _CONSUMER_CARE_KEYWORDS) or is_email or is_phone

    def _is_country_of_origin(self, text: str) -> bool:
        return _has_keyword(normalize_phrase(text), _COUNTRY_KEYWORDS)

    # --- Rule Evaluators ---

    def _eval_mrp(self, block: TextBlock, ocr_result: OCRScanResult,
                  doc_norm: Optional[str] = None) -> tuple[DeclarationFound, List[ViolationDetail]]:
        text = block.text

        # Check format: MRP must mention inclusive of all taxes.
        # The clause is matched against the flattened WHOLE-DOCUMENT text, never against
        # the single block: printers routinely set "(incl. of all taxes)" on its own line
        # under the price, and OCR can even split the clause itself across two blocks
        # ("MRP Rs 120 (Incl." + "of all taxes)"). Matching per line, or against the
        # newline-joined raw text, flagged all of those as a missing tax clause.
        if doc_norm is None:
            doc_norm = self._document_text(ocr_result)
        has_tax_clause_found = has_tax_clause(doc_norm) or has_tax_clause(normalize_phrase(text))

        format_valid = has_tax_clause_found
        viols = []

        if not format_valid:
            viols.append(ViolationDetail(
                id=f"viol_mrp_tax_{block.id}",
                rule_id="mrp",
                field_name=self.rule_map.get("mrp", {}).get("field_name", "Maximum Retail Price (MRP)"),
                violation_type="wrong_format",
                severity="MAJOR",
                description="MRP declaration is missing mandated tax clause '(incl. of all taxes)' as per Legal Metrology Rule 6.",
                evidence_bbox=block.bbox
            ))

        min_font = self._get_min_font_size("mrp", 1.0)
        font_size_mm = self._estimate_font_mm(block.size.estimated_font_size_px, ocr_result.image_metadata.height)
        size_valid = font_size_mm >= min_font

        if not size_valid:
            viols.append(ViolationDetail(
                id=f"viol_mrp_size_{block.id}",
                rule_id="mrp",
                field_name=self.rule_map.get("mrp", {}).get("field_name", "Maximum Retail Price (MRP)"),
                violation_type="too_small",
                severity="MINOR",
                description=f"MRP text font size ({font_size_mm:.1f}mm) is below prescribed minimum height ({min_font:.1f}mm).",
                evidence_bbox=block.bbox
            ))

        status = "COMPLIANT" if (format_valid and size_valid) else ("FORMAT_ERROR" if not format_valid else "TOO_SMALL")

        decl = DeclarationFound(
            id="mrp",
            field_name=self.rule_map.get("mrp", {}).get("field_name", "Maximum Retail Price (MRP)"),
            extracted_text=text,
            parsed_value=text,
            confidence=block.confidence,
            bbox=block.bbox,
            font_size_px=block.size.estimated_font_size_px,
            font_size_mm_est=font_size_mm,
            format_valid=format_valid,
            size_valid=size_valid,
            status=status
        )
        return decl, viols

    def _eval_net_quantity(self, block: TextBlock, img_height: int) -> tuple[DeclarationFound, List[ViolationDetail]]:
        text = block.text
        t_upper = flatten_text(text)
        viols = []

        # Check for non-standard unit symbols (e.g. gms, ltrs, kilo)
        has_illegal_unit = bool(re.search(r'\b(GMS|LTRS|KILO|CTS)\b', t_upper))
        format_valid = not has_illegal_unit

        if has_illegal_unit:
            viols.append(ViolationDetail(
                id=f"viol_net_qty_symbol_{block.id}",
                rule_id="net_quantity",
                field_name=self.rule_map.get("net_quantity", {}).get("field_name", "Net Quantity"),
                violation_type="wrong_format",
                severity="MAJOR",
                description="Net Quantity uses non-standard unit symbol ('gms'/'ltrs'). Legal Metrology mandates standard SI units ('g', 'kg', 'ml', 'L', 'N').",
                evidence_bbox=block.bbox
            ))

        min_font = self._get_min_font_size("net_quantity", 1.0)
        font_size_mm = self._estimate_font_mm(block.size.estimated_font_size_px, img_height)
        size_valid = font_size_mm >= min_font

        if not size_valid:
            viols.append(ViolationDetail(
                id=f"viol_net_qty_size_{block.id}",
                rule_id="net_quantity",
                field_name=self.rule_map.get("net_quantity", {}).get("field_name", "Net Quantity"),
                violation_type="too_small",
                severity="MINOR",
                description=f"Net Quantity font size ({font_size_mm:.1f}mm) is below prescribed minimum height ({min_font:.1f}mm).",
                evidence_bbox=block.bbox
            ))

        status = "COMPLIANT" if (format_valid and size_valid) else ("FORMAT_ERROR" if not format_valid else "TOO_SMALL")

        decl = DeclarationFound(
            id="net_quantity",
            field_name=self.rule_map.get("net_quantity", {}).get("field_name", "Net Quantity"),
            extracted_text=text,
            parsed_value=text,
            confidence=block.confidence,
            bbox=block.bbox,
            font_size_px=block.size.estimated_font_size_px,
            font_size_mm_est=font_size_mm,
            format_valid=format_valid,
            size_valid=size_valid,
            status=status
        )
        return decl, viols

    def _eval_mfg_date(self, block: TextBlock, img_height: int) -> tuple[DeclarationFound, List[ViolationDetail]]:
        text = block.text
        min_font = self._get_min_font_size("manufacture_date", 1.0)
        font_size_mm = self._estimate_font_mm(block.size.estimated_font_size_px, img_height)
        size_valid = font_size_mm >= min_font
        viols = []

        if not size_valid:
            viols.append(ViolationDetail(
                id=f"viol_mfg_date_size_{block.id}",
                rule_id="manufacture_date",
                field_name=self.rule_map.get("manufacture_date", {}).get("field_name", "Month and Year of Manufacture"),
                violation_type="too_small",
                severity="MINOR",
                description=f"Month/Year of Manufacture font size ({font_size_mm:.1f}mm) is below prescribed minimum height ({min_font:.1f}mm).",
                evidence_bbox=block.bbox
            ))

        decl = DeclarationFound(
            id="manufacture_date",
            field_name=self.rule_map.get("manufacture_date", {}).get("field_name", "Month and Year of Manufacture"),
            extracted_text=text,
            parsed_value=text,
            confidence=block.confidence,
            bbox=block.bbox,
            font_size_px=block.size.estimated_font_size_px,
            font_size_mm_est=font_size_mm,
            format_valid=True,
            size_valid=size_valid,
            status="COMPLIANT" if size_valid else "TOO_SMALL"
        )
        return decl, viols

    def _eval_manufacturer_details(self, block: TextBlock, img_height: int) -> tuple[DeclarationFound, List[ViolationDetail]]:
        text = block.text
        min_font = self._get_min_font_size("manufacturer_details", 1.0)
        font_size_mm = self._estimate_font_mm(block.size.estimated_font_size_px, img_height)
        size_valid = font_size_mm >= min_font
        viols = []

        if not size_valid:
            viols.append(ViolationDetail(
                id=f"viol_mfg_details_size_{block.id}",
                rule_id="manufacturer_details",
                field_name=self.rule_map.get("manufacturer_details", {}).get("field_name", "Manufacturer Name & Address"),
                violation_type="too_small",
                severity="MINOR",
                description=f"Manufacturer details font size ({font_size_mm:.1f}mm) is below prescribed minimum height ({min_font:.1f}mm).",
                evidence_bbox=block.bbox
            ))

        decl = DeclarationFound(
            id="manufacturer_details",
            field_name=self.rule_map.get("manufacturer_details", {}).get("field_name", "Manufacturer Name & Address"),
            extracted_text=text,
            parsed_value=text,
            confidence=block.confidence,
            bbox=block.bbox,
            font_size_px=block.size.estimated_font_size_px,
            font_size_mm_est=font_size_mm,
            format_valid=True,
            size_valid=size_valid,
            status="COMPLIANT" if size_valid else "TOO_SMALL"
        )
        return decl, viols

    def _eval_consumer_care(self, block: TextBlock, img_height: int) -> tuple[DeclarationFound, List[ViolationDetail]]:
        text = block.text
        min_font = self._get_min_font_size("consumer_care", 1.0)
        font_size_mm = self._estimate_font_mm(block.size.estimated_font_size_px, img_height)
        size_valid = font_size_mm >= min_font
        viols = []

        if not size_valid:
            viols.append(ViolationDetail(
                id=f"viol_consumer_care_size_{block.id}",
                rule_id="consumer_care",
                field_name=self.rule_map.get("consumer_care", {}).get("field_name", "Consumer Care Details"),
                violation_type="too_small",
                severity="MINOR",
                description=f"Consumer care font size ({font_size_mm:.1f}mm) is below prescribed minimum height ({min_font:.1f}mm).",
                evidence_bbox=block.bbox
            ))

        decl = DeclarationFound(
            id="consumer_care",
            field_name=self.rule_map.get("consumer_care", {}).get("field_name", "Consumer Care Details"),
            extracted_text=text,
            parsed_value=text,
            confidence=block.confidence,
            bbox=block.bbox,
            font_size_px=block.size.estimated_font_size_px,
            font_size_mm_est=font_size_mm,
            format_valid=True,
            size_valid=size_valid,
            status="COMPLIANT" if size_valid else "TOO_SMALL"
        )
        return decl, viols

    def _eval_country_of_origin(self, block: TextBlock, img_height: int) -> tuple[DeclarationFound, List[ViolationDetail]]:
        text = block.text
        min_font = self._get_min_font_size("country_of_origin", 1.0)
        font_size_mm = self._estimate_font_mm(block.size.estimated_font_size_px, img_height)
        size_valid = font_size_mm >= min_font
        viols = []

        if not size_valid:
            viols.append(ViolationDetail(
                id=f"viol_country_of_origin_size_{block.id}",
                rule_id="country_of_origin",
                field_name=self.rule_map.get("country_of_origin", {}).get("field_name", "Country of Origin"),
                violation_type="too_small",
                severity="MINOR",
                description=f"Country of origin font size ({font_size_mm:.1f}mm) is below prescribed minimum height ({min_font:.1f}mm).",
                evidence_bbox=block.bbox
            ))

        decl = DeclarationFound(
            id="country_of_origin",
            field_name=self.rule_map.get("country_of_origin", {}).get("field_name", "Country of Origin"),
            extracted_text=text,
            parsed_value=text,
            confidence=block.confidence,
            bbox=block.bbox,
            font_size_px=block.size.estimated_font_size_px,
            font_size_mm_est=font_size_mm,
            format_valid=True,
            size_valid=size_valid,
            status="COMPLIANT" if size_valid else "TOO_SMALL"
        )
        return decl, viols

    def _estimate_font_mm(self, font_size_px: float, img_height_px: int) -> float:
        """Estimates physical font height in mm based on pixel scaling."""
        # Standard packaging photo physical height ~150mm
        est_mm = (font_size_px / max(img_height_px, 1)) * 150.0
        return round(max(est_mm, 1.0), 1)


# Helper function to evaluate image compliance directly
def evaluate_label_compliance(ocr_result: OCRScanResult, ruleset: Optional[Dict[str, Any]] = None, db: Optional[Any] = None) -> ComplianceResult:
    evaluator = ComplianceEvaluator(ruleset=ruleset, db=db)
    return evaluator.evaluate(ocr_result)

