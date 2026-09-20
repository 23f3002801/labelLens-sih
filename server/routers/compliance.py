import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, File, UploadFile, Query, HTTPException, status, Depends
from pydantic import BaseModel

from schemas.compliance import ComplianceResult, LegalCitation
from schemas.ocr import OCRScanResult
from services.ocr_service import get_ocr_service
from services.compliance_evaluator import evaluate_label_compliance, evaluate_label_compliance_multi
from services.rag.citation_service import get_citation_service

logger = logging.getLogger("compliance_router")


class ComplianceEvaluationRequest(BaseModel):
    ocr_result: OCRScanResult
    ruleset: Dict[str, Any]


class FaceOCR(BaseModel):
    face_index: int
    filename: str = ""
    ocr_result: OCRScanResult


class MultiFaceEvaluationRequest(BaseModel):
    faces: list[FaceOCR]
    ruleset: Dict[str, Any]

router = APIRouter(prefix="/api/v1/compliance", tags=["Compliance Evaluation Engine"])


@router.get(
    "/rules",
    summary="Get active Legal Metrology mandatory declarations ruleset",
    description="Returns active rules list dynamically loaded from database compliance_rules table filtered by category.",
)
def get_active_rules(
    category: Optional[str] = Query(
        default="general",
        description="Product category (general, food, cosmetics, textile, electronics, all)",
    ),
):
    raise HTTPException(status_code=410, detail="Rules are owned by the Node Prisma service.")


@router.post(
    "/evaluate-image",
    response_model=ComplianceResult,
    summary="End-to-end Legal Metrology compliance evaluation from label photo upload",
    description="Runs OCR extraction, evaluates active Legal Metrology DB rules for category, logs inspection in DB, and returns structured result.",
)
async def evaluate_image_compliance(
    file: UploadFile = File(..., description="Packaged product label photo"),
    enhance: bool = Query(default=True, description="Apply contrast enhancement preprocessing"),
    min_confidence: float = Query(default=0.3, ge=0.0, le=1.0, description="Minimum OCR confidence threshold"),
    category: Optional[str] = Query(default=None, description="Product category override (food, cosmetics, textile, electronics, general)"),
    product_id: Optional[str] = Query(default=None, description="Ignored; product data is owned by Node Prisma"),
):
    raise HTTPException(status_code=410, detail="Use the Node Prisma scan workflow for persisted image evaluations.")

    # The legacy implementation below is intentionally unreachable. Keeping the
    # endpoint name makes accidental direct use fail clearly during migration.
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type '{file.content_type}'. Must be an image file."
        )

    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Uploaded image is empty.")

        # Resolve category (explicit override > product lookup > 'general')
        resolved_category = category if category not in ("string", "") else None
        resolved_product_id = product_id if product_id not in ("string", "") else None
        if not resolved_category and resolved_product_id:
            product = db.get(Product, resolved_product_id)
            if product and product.category:
                resolved_category = product.category
        resolved_category = (resolved_category or "general").strip().lower()

        # Step 1: Run OCR Extraction Engine
        ocr_service = get_ocr_service()
        ocr_result = ocr_service.extract_text(
            image_bytes,
            enhance=enhance,
            min_confidence=min_confidence,
            include_annotated_image=True
        )

        if not ocr_result.success:
            raise HTTPException(status_code=500, detail=f"OCR Extraction failed: {ocr_result.error}")

        # Step 2: Run Compliance Evaluator Engine with category-scoped DB rules
        ruleset = get_rules_for_category(category=resolved_category, db=db)
        compliance_result = evaluate_label_compliance(
            ocr_result,
            ruleset=ruleset,
            db=db,
            category=resolved_category,
            image_bytes=image_bytes
        )

        # Step 3: Persist Inspection Record and Violations to Database
        try:
            # Save annotated evidence image to disk if present
            ann_path = None
            if compliance_result.annotated_image_base64:
                import uuid
                from pathlib import Path
                upload_dir = Path(__file__).resolve().parent.parent / "storage" / "uploads"
                upload_dir.mkdir(parents=True, exist_ok=True)
                ann_filename = f"eval_{uuid.uuid4().hex[:12]}_annotated.jpg"
                try:
                    with open(upload_dir / ann_filename, "wb") as f:
                        f.write(base64.b64decode(compliance_result.annotated_image_base64))
                    ann_path = f"/uploads/{ann_filename}"
                except Exception as save_err:
                    logger.warning("Could not save evaluation annotated image: %s", save_err)

            # Create Inspection Log
            inspection_log = Inspection(
                product_id=resolved_product_id,
                category=resolved_category,
                annotated_image_path=ann_path,
                raw_ocr_output=ocr_result.model_dump(),
                extracted_declarations=[d.model_dump() for d in compliance_result.summary.what_was_found],
                compliance_score=compliance_result.compliance_score,
                status="COMPLIANT" if compliance_result.overall_result == "PASS" else "NON_COMPLIANT"
            )
            db.add(inspection_log)
            db.commit()
            db.refresh(inspection_log)

            # Create Violation Records
            for v in compliance_result.summary.whats_wrong:
                v_type = (v.violation_type or "NON_COMPLIANT").upper()
                v_sev = v.severity or "CRITICAL"
                viol_obj = Violation(
                    inspection_id=inspection_log.id,
                    rule_code=v.rule_id,
                    severity=v_sev,
                    title=f"{v.field_name} - {v_type}"[:150],
                    description=str(v.description or "")[:500],
                    evidence_bbox=v.evidence_bbox.model_dump() if v.evidence_bbox else None,
                    citation=v.citation.model_dump() if v.citation else None
                )
                db.add(viol_obj)
            db.commit()

        except Exception as db_err:
            logger.exception(
                "Failed to persist inspection/violations for compliance evaluation: %s", db_err
            )
            db.rollback()

        return compliance_result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Compliance evaluation failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during compliance evaluation: {str(e)}"
        )


@router.post(
    "/evaluate-ocr",
    response_model=ComplianceResult,
    summary="Evaluate Legal Metrology compliance from pre-computed OCR JSON output",
    description="Takes raw OCRScanResult JSON output and evaluates against category-scoped Legal Metrology DB ruleset.",
)
async def evaluate_ocr_payload(
    request: "ComplianceEvaluationRequest",
    category: Optional[str] = Query(default="general", description="Product category (food, cosmetics, textile, electronics, general)"),
    product_id: Optional[str] = Query(default=None, description="Ignored; product data is owned by Node Prisma"),
):
    resolved_category = (category or "general").strip().lower()
    if not request.ruleset.get("mandatory_declarations"):
        raise HTTPException(status_code=422, detail="A Prisma-managed ruleset is required.")
    result = evaluate_label_compliance(request.ocr_result, ruleset=request.ruleset, category=resolved_category)
    return result


@router.post(
    "/evaluate-ocr-multi",
    response_model=ComplianceResult,
    summary="Evaluate a complete product across multiple label faces",
)
async def evaluate_multi_face_payload(
    request: MultiFaceEvaluationRequest,
    category: Optional[str] = Query(default="general"),
):
    resolved_category = (category or "general").strip().lower()
    if not request.ruleset.get("mandatory_declarations"):
        raise HTTPException(status_code=422, detail="A Prisma-managed ruleset is required.")
    if not request.faces:
        raise HTTPException(status_code=422, detail="At least one face OCR result is required.")

    ordered_faces = sorted(request.faces, key=lambda face: face.face_index)
    result = evaluate_label_compliance_multi(
        [face.ocr_result for face in ordered_faces],
        ruleset=request.ruleset,
        category=resolved_category,
    )
    return result


@router.get(
    "/citations",
    summary="List all official statutory Act/Rule citations",
    description="Returns dictionary of all mapped Legal Metrology, FSSAI, Cosmetics, and BIS statutory citations.",
)
def get_all_statutory_citations():
    citation_svc = get_citation_service()
    return {
        rule_id: cit.model_dump()
        for rule_id, cit in citation_svc.get_all_citations().items()
    }


@router.get(
    "/citations/{rule_id}",
    response_model=LegalCitation,
    summary="Get statutory Act, Rule number, and verbatim quote for a specific compliance rule",
    description="Retrieves official Gazette notification citation and statutory text for a given rule_id.",
)
def get_rule_statutory_citation(rule_id: str):
    citation_svc = get_citation_service()
    cit = citation_svc.get_citation(rule_id)
    if not cit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No statutory citation found for rule '{rule_id}'."
        )
    return cit


@router.get(
    "/citations-search",
    summary="Search statutory legal corpus",
    description="Searches 1,144+ extracted statutory pages from official Indian compliance Acts and Gazette notifications.",
)
def search_statutory_corpus(
    q: str = Query(..., description="Search query terms (e.g. 'unit sale price', 'maximum retail price', 'fssai font')"),
    top_k: int = Query(default=3, ge=1, le=10, description="Maximum number of statutory excerpts to return"),
):
    citation_svc = get_citation_service()
    results = citation_svc.search_statutory_corpus(q, top_k=top_k)
    return {
        "query": q,
        "total_results": len(results),
        "results": results,
    }
