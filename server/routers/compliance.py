import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, File, UploadFile, Query, HTTPException, status

from schemas.compliance import ComplianceResult
from schemas.ocr import OCRScanResult
from services.ocr_service import get_ocr_service
from services.compliance_evaluator import evaluate_label_compliance
from services.rule_loader import load_rules_from_file

logger = logging.getLogger("compliance_router")

router = APIRouter(prefix="/api/v1/compliance", tags=["Compliance Evaluation Engine"])

@router.get(
    "/rules",
    summary="Get active Legal Metrology mandatory declarations ruleset",
    description="Returns active rules list loaded from rules configuration."
)
def get_active_rules():
    return load_rules_from_file()


@router.post(
    "/evaluate-image",
    response_model=ComplianceResult,
    summary="Stateless Legal Metrology compliance evaluation from label photo upload",
    description="Runs OCR extraction, evaluates active Legal Metrology rules, and returns structured result without DB side-effects."
)
async def evaluate_image_compliance(
    file: UploadFile = File(..., description="Packaged product label photo"),
    enhance: bool = Query(default=True, description="Apply contrast enhancement preprocessing"),
    min_confidence: float = Query(default=0.3, ge=0.0, le=1.0, description="Minimum OCR confidence threshold"),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type '{file.content_type}'. Must be an image file."
        )

    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Uploaded image is empty.")

        ocr_service = get_ocr_service()
        ocr_result = ocr_service.extract_text(
            image_bytes,
            enhance=enhance,
            min_confidence=min_confidence,
            include_annotated_image=True
        )

        if not ocr_result.success:
            raise HTTPException(status_code=500, detail=f"OCR Extraction failed: {ocr_result.error}")

        ruleset = load_rules_from_file()
        compliance_result = evaluate_label_compliance(ocr_result, ruleset=ruleset)
        return compliance_result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Stateless compliance evaluation failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during compliance evaluation: {str(e)}"
        )


@router.post(
    "/evaluate-ocr",
    response_model=ComplianceResult,
    summary="Evaluate Legal Metrology compliance from pre-computed OCR JSON output",
    description="Takes raw OCRScanResult JSON output and evaluates against Legal Metrology ruleset."
)
def evaluate_ocr_payload(ocr_result: OCRScanResult):
    ruleset = load_rules_from_file()
    result = evaluate_label_compliance(ocr_result, ruleset=ruleset)
    return result
