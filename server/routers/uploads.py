import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import Inspection, Violation, Product
from services.compliance_evaluator import evaluate_label_compliance
from services.cloudinary_service import upload_image as upload_image_to_cloudinary
from services.ocr_service import get_ocr_service
from services.rule_loader import load_rules_from_file, get_rules_from_db, get_rules_for_category

logger = logging.getLogger("uploads")

router = APIRouter(prefix="/api/v1/uploads", tags=["Image Uploads"])

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def _process_scan(inspection_id: str, image_bytes: bytes, db: Session | None = None):
    own_session = db is None
    db = db or SessionLocal()

    try:
        inspection = db.get(Inspection, inspection_id)
        if inspection is None:
            return

        try:
            inspection.status = "PROCESSING"
            db.commit()

            ocr_result = get_ocr_service().extract_text(
                image_bytes,
                enhance=True,
                include_annotated_image=True,
            )
            if not ocr_result.success:
                raise RuntimeError(ocr_result.error or "OCR extraction failed")

            cat = inspection.category
            if not cat and inspection.product_id:
                product = db.get(Product, inspection.product_id)
                if product and product.category:
                    cat = product.category
            cat = (cat or "general").strip().lower()
            inspection.category = cat

            ruleset = get_rules_for_category(category=cat, db=db)
            compliance_result = evaluate_label_compliance(
                ocr_result,
                ruleset=ruleset,
                db=db,
                category=cat,
                image_bytes=image_bytes,
            )

            structured_result = compliance_result.structured_result or {
                "compliance_score": compliance_result.compliance_score,
                "extracted_declarations": [],
                "violation_list": [],
                "final_status": "COMPLIANT" if compliance_result.overall_result == "PASS" else "NON_COMPLIANT",
            }
            if hasattr(structured_result, "model_dump"):
                structured_result = structured_result.model_dump()

            inspection.raw_ocr_output = ocr_result.model_dump()
            if inspection.extracted_declarations is None:
                inspection.extracted_declarations = [
                    declaration.model_dump()
                    for declaration in compliance_result.summary.what_was_found
                ]
            inspection.compliance_score = compliance_result.compliance_score
            if inspection.status == "PROCESSING":
                inspection.status = (
                    "COMPLIANT"
                    if compliance_result.overall_result == "PASS"
                    else "NON_COMPLIANT"
                )

            # Save annotated violation evidence image to disk so user can view it in browser
            if compliance_result.annotated_image_base64:
                import base64
                upload_dir = Path(__file__).resolve().parent.parent / "storage" / "uploads"
                upload_dir.mkdir(parents=True, exist_ok=True)
                ann_filename = f"scan_{inspection.id}_annotated.jpg"
                ann_path = upload_dir / ann_filename
                try:
                    with open(ann_path, "wb") as f:
                        f.write(base64.b64decode(compliance_result.annotated_image_base64))
                    inspection.annotated_image_path = f"/uploads/{ann_filename}"
                except Exception as err:
                    logger.warning("Could not write annotated image file: %s", err)

            # Store structured compliance payload alongside the DB row for consistent UI/API consumption.
            inspection.raw_ocr_output = {
                **(inspection.raw_ocr_output or {}),
                "structured_compliance": structured_result,
            }

            for violation in compliance_result.summary.whats_wrong:
                v_type = (violation.violation_type or "NON_COMPLIANT").upper()
                v_sev = violation.severity or "CRITICAL"
                v_title = f"{violation.field_name} - {v_type}"[:150]
                v_desc = str(violation.description or "")[:500]
                db.add(
                    Violation(
                        inspection_id=inspection.id,
                        rule_code=violation.rule_id,
                        severity=v_sev,
                        title=v_title,
                        description=v_desc,
                        evidence_bbox=(
                            violation.evidence_bbox.model_dump()
                            if violation.evidence_bbox
                            else None
                        ),
                    )
                )

            db.commit()
        except Exception:
            logger.exception("Scan processing failed for inspection_id=%s", inspection_id)
            db.rollback()
            inspection = db.get(Inspection, inspection_id)
            if inspection is not None:
                inspection.status = "FAILED"
                db.commit()
    finally:
        if own_session:
            db.close()


@router.post("/image", status_code=status.HTTP_202_ACCEPTED)
async def upload_image(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="Label photo file"),
    category: Optional[str] = Form(default=None, description="Product category (food, cosmetics, textile, electronics, general)"),
    product_id: Optional[str] = Form(default=None, description="Optional Product ID"),
    category_query: Optional[str] = Query(default=None, alias="category"),
    product_id_query: Optional[str] = Query(default=None, alias="product_id"),
    db: Session = Depends(get_db),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. An image file is required.",
        )

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded image file is empty.",
        )

    filename = file.filename or "label.jpg"
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image extension.",
        )

    resolved_category = category or category_query
    resolved_product_id = product_id or product_id_query
    if resolved_category in ("string", ""):
        resolved_category = None
    if resolved_product_id in ("string", ""):
        resolved_product_id = None

    if not resolved_category and resolved_product_id:
        product = db.get(Product, resolved_product_id)
        if product and product.category:
            resolved_category = product.category
    if resolved_category:
        resolved_category = resolved_category.strip().lower()

    inspection = Inspection(
        status="PROCESSING",
        category=resolved_category,
        product_id=resolved_product_id,
    )

    try:
        db.add(inspection)
        db.commit()
        db.refresh(inspection)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create the scan record.",
        )

    try:
        cloudinary_image = upload_image_to_cloudinary(
            image_bytes,
            filename,
            public_id=f"scan_{inspection.id}",
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not upload image to Cloudinary: {exc}",
        ) from exc

    inspection.image_path = cloudinary_image["secure_url"]
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update the scan record with the Cloudinary URL.",
        )

    background_tasks.add_task(_process_scan, inspection.id, image_bytes)

    return {
        "scan_id": inspection.id,
        "filename": filename,
        "image_url": cloudinary_image["secure_url"],
        "cloudinary_public_id": cloudinary_image["public_id"],
        "status": inspection.status,
    }


@router.get("/{scan_id}")
def get_scan_result(scan_id: str, db: Session = Depends(get_db)):
    inspection = db.get(Inspection, scan_id)
    if inspection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scan not found.",
        )

    violations = [
        {
            "id": violation.id,
            "rule_code": violation.rule_code,
            "severity": violation.severity,
            "title": violation.title,
            "description": violation.description,
            "evidence_bbox": violation.evidence_bbox,
        }
        for violation in inspection.violations
    ]

    return {
        "scan_id": inspection.id,
        "product_id": inspection.product_id,
        "category": inspection.category,
        "status": inspection.status,
        "image_path": inspection.image_path,
        "annotated_image_url": inspection.annotated_image_path,
        "created_at": inspection.created_at,
        "compliance_score": inspection.compliance_score,
        "ocr_result": inspection.raw_ocr_output,
        "extracted_declarations": inspection.extracted_declarations,
        "violations": violations,
    }