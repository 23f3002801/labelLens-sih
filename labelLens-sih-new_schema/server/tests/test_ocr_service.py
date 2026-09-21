import sys
import os
import io
import base64
import pytest
import numpy as np
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

# Ensure server root is in python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
from services.ocr_service import extract_text_from_image, get_ocr_service
from schemas.ocr import OCRScanResult

client = TestClient(app)

def create_sample_label_image(width=600, height=300) -> Image.Image:
    """Helper to generate a synthetic packaged commodity label image for testing."""
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((30, 30), "MRP Rs 250.00 (INCL. OF ALL TAXES)", fill=(0, 0, 0))
    draw.text((30, 80), "NET QTY: 1 kg", fill=(0, 0, 0))
    draw.text((30, 130), "MFG DATE: 05/2026", fill=(0, 0, 0))
    draw.text((30, 180), "Mfd by: Pure Spices India Pvt Ltd", fill=(0, 0, 0))
    return img

def image_to_bytes(img: Image.Image, format="JPEG") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=format)
    return buf.getvalue()


def test_ocr_service_direct_call():
    """Test calling extract_text_from_image python function directly."""
    img = create_sample_label_image()
    result = extract_text_from_image(img, include_annotated_image=True)

    assert result.success is True
    assert result.total_text_blocks > 0
    assert result.image_metadata.width == 600
    assert result.image_metadata.height == 300
    assert result.annotated_image_base64 is not None

    # Verify every text block contains required attributes: text, position, size
    for block in result.text_blocks:
        assert isinstance(block.text, str)
        assert len(block.text) > 0
        assert 0.0 <= block.confidence <= 1.0
        assert len(block.polygon) == 4
        assert block.size.width > 0
        assert block.size.height > 0
        assert block.size.estimated_font_size_px > 0
        assert block.bbox.x_min < block.bbox.x_max
        assert block.bbox.y_min < block.bbox.y_max


def test_ocr_scan_file_endpoint():
    """Test POST /api/v1/ocr/scan endpoint with multipart file upload."""
    img = create_sample_label_image()
    img_bytes = image_to_bytes(img)

    response = client.post(
        "/api/v1/ocr/scan",
        files={"file": ("label.jpg", img_bytes, "image/jpeg")},
        params={"enhance": "false", "min_confidence": 0.3}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["total_text_blocks"] > 0
    assert "MRP" in data["raw_text"] or "NET QTY" in data["raw_text"]


def test_ocr_scan_base64_endpoint():
    """Test POST /api/v1/ocr/scan-base64 endpoint."""
    img = create_sample_label_image()
    img_bytes = image_to_bytes(img)
    b64_str = base64.b64encode(img_bytes).decode("utf-8")

    response = client.post(
        "/api/v1/ocr/scan-base64",
        json={
            "image_base64": f"data:image/jpeg;base64,{b64_str}",
            "enhance": False,
            "min_confidence": 0.3
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["total_text_blocks"] > 0


def test_invalid_file_type_handling():
    """Test uploading non-image file returns 400 Bad Request."""
    response = client.post(
        "/api/v1/ocr/scan",
        files={"file": ("document.txt", b"Hello world text file", "text/plain")}
    )
    assert response.status_code == 400
    assert "Invalid file type" in response.json()["detail"]
