import base64
from typing import Optional
from fastapi import APIRouter, File, UploadFile, Query, HTTPException, status
from pydantic import BaseModel, Field

from schemas.ocr import OCRScanResult
from services.ocr_service import get_ocr_service

router = APIRouter(prefix="/api/v1/ocr", tags=["OCR Extraction Engine"])

class Base64ScanRequest(BaseModel):
    image_base64: str = Field(..., description="Base64 encoded image string (data:image/jpeg;base64,... or raw base64)")
    enhance: bool = Field(default=False, description="Apply adaptive contrast enhancement before OCR")
    min_confidence: float = Field(default=0.3, ge=0.0, le=1.0, description="Minimum confidence threshold")
    include_annotated_image: bool = Field(default=False, description="Include base64 visualization overlay in response")
    fallback: bool = Field(default=True, description="Enable multi-pipeline fallback for low contrast/faded labels")

@router.post(
    "/scan",
    response_model=OCRScanResult,
    summary="Extract text blocks, position, and size from a label photo upload",
    description="Reads a label image file upload, detects all text blocks, calculates exact positions (bbox/polygon) and font sizes."
)
async def scan_label_image(
    file: UploadFile = File(..., description="Label photo file (JPEG, PNG, WEBP, etc.)"),
    enhance: bool = Query(default=False, description="Apply contrast enhancement preprocessing"),
    min_confidence: float = Query(default=0.3, ge=0.0, le=1.0, description="Minimum OCR confidence threshold"),
    include_annotated_image: bool = Query(default=False, description="Return base64 annotated image with bounding boxes"),
    fallback: bool = Query(default=True, description="Enable multi-pipeline fallback preprocessing on sparse text")
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type '{file.content_type}'. Must be an image file."
        )

    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded image file is empty."
            )

        ocr_service = get_ocr_service()
        result = ocr_service.extract_text(
            image_bytes,
            enhance=enhance,
            min_confidence=min_confidence,
            include_annotated_image=include_annotated_image,
            fallback=fallback
        )

        if not result.success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"OCR Extraction failed: {result.error}"
            )

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while processing the image: {str(e)}"
        )


@router.post(
    "/scan-base64",
    response_model=OCRScanResult,
    summary="Extract text blocks from base64 encoded label image",
    description="Accepts JSON body with base64 encoded image string for OCR extraction."
)
async def scan_label_base64(request: Base64ScanRequest):
    try:
        b64_str = request.image_base64
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]

        image_bytes = base64.b64decode(b64_str)
        if len(image_bytes) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Decoded base64 image data is empty."
            )

        ocr_service = get_ocr_service()
        result = ocr_service.extract_text(
            image_bytes,
            enhance=request.enhance,
            min_confidence=request.min_confidence,
            include_annotated_image=request.include_annotated_image,
            fallback=request.fallback
        )

        if not result.success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"OCR Extraction failed: {result.error}"
            )

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process base64 image: {str(e)}"
        )
