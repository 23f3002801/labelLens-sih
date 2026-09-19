import os
import json
import io
import sys
import base64
import pytest
from unittest.mock import patch, MagicMock
from PIL import Image

# Ensure server root is in python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.llm_evaluator import (
    verify_grounding,
    normalize_for_grounding,
    find_matching_bbox,
    LLMComplianceEvaluator,
    get_llm_evaluator,
)
from services.compliance_evaluator import (
    ComplianceEvaluator,
    evaluate_label_compliance,
)
from schemas.ocr import OCRScanResult, TextBlock, BBox, BlockSize, Point, ImageMetadata
from schemas.compliance import ViolationDetail, DeclarationMissing


def test_normalize_for_grounding():
    """Strips punctuation and standardizes spacing."""
    assert normalize_for_grounding("M.R.P. Rs. 250.00 (Incl. of all taxes)") == "m r p rs 250 00 incl of all taxes"
    assert normalize_for_grounding("Net  Qty:  100g") == "net qty 100g"


def test_verify_grounding_positive_and_negative():
    """Grounding verifier must catch hallucinated quotes and allow real ones."""
    ocr_raw_text = (
        "BRITANNIA GOOD DAY\n"
        "MRP Rs. 30.00 (INCL. OF ALL TAXES)\n"
        "Net Qty: 120g\n"
        "Mfg Date: 08/2024\n"
        "Mfd by: Britannia Industries Ltd, Kolkata 700017\n"
        "100% Vegetarian"
    )

    # 1. Exact verbatim quote -> PASS
    assert verify_grounding("MRP Rs. 30.00 (INCL. OF ALL TAXES)", ocr_raw_text) is True
    # 2. Case-insensitive & normalized punctuation -> PASS
    assert verify_grounding("mrp rs 30.00", ocr_raw_text) is True
    # 3. Substring match -> PASS
    assert verify_grounding("Net Qty: 120g", ocr_raw_text) is True

    # 4. Hallucinated quote (e.g. LLM invented an FSSAI number not on the pack) -> FAIL
    assert verify_grounding("FSSAI Lic. No. 10012022000123", ocr_raw_text) is False
    # 5. Hallucinated consumer helpline -> FAIL
    assert verify_grounding("Consumer Care: 1800-999-8888", ocr_raw_text) is False
    # 6. Empty / None -> FAIL
    assert verify_grounding("", ocr_raw_text) is False
    assert verify_grounding(None, ocr_raw_text) is False


def test_find_matching_bbox():
    """Finds appropriate BBox for exact_quote from text blocks."""
    blocks = [
        TextBlock(
            id=1,
            text="MRP Rs. 50.00",
            confidence=0.95,
            polygon=[[10, 10], [100, 10], [100, 30], [10, 30]],
            bbox=BBox(x_min=10, y_min=10, x_max=100, y_max=30),
            size=BlockSize(width=90, height=20, aspect_ratio=4.5, estimated_font_size_px=20),
            center=Point(x=55, y=20)
        ),
        TextBlock(
            id=2,
            text="Net Qty: 200g",
            confidence=0.95,
            polygon=[[10, 40], [100, 40], [100, 60], [10, 60]],
            bbox=BBox(x_min=10, y_min=40, x_max=100, y_max=60),
            size=BlockSize(width=90, height=20, aspect_ratio=4.5, estimated_font_size_px=20),
            center=Point(x=55, y=50)
        )
    ]

    bbox = find_matching_bbox("MRP Rs. 50.00", blocks)
    assert bbox is not None
    assert bbox.y_min == 10
    assert bbox.y_max == 30

    bbox_qty = find_matching_bbox("200g", blocks)
    assert bbox_qty is not None
    assert bbox_qty.y_min == 40


def test_violation_evidence_image_generator():
    """Issue #30: Generates color-coded evidence image highlighting only non-compliant blocks."""
    # Create sample image
    img = Image.new("RGB", (400, 300), color=(240, 240, 240))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    img_bytes = buf.getvalue()

    evaluator = ComplianceEvaluator()

    violations = [
        ViolationDetail(
            id="v1",
            rule_id="mrp",
            field_name="Maximum Retail Price (MRP)",
            violation_type="wrong_format",
            severity="CRITICAL",
            description="Missing tax inclusion statement",
            evidence_bbox=BBox(x_min=20, y_min=50, x_max=200, y_max=90)
        ),
        ViolationDetail(
            id="v2",
            rule_id="net_quantity",
            field_name="Net Quantity",
            violation_type="too_small",
            severity="MINOR",
            description="Font size below statutory minimum",
            evidence_bbox=BBox(x_min=20, y_min=120, x_max=150, y_max=145)
        )
    ]

    missing = [
        DeclarationMissing(
            id="consumer_care",
            field_name="Consumer Care Details",
            description="Missing helpline email/phone",
            required=True
        )
    ]

    b64_output = evaluator.generate_violation_evidence_image(img_bytes, violations, missing)
    assert b64_output is not None
    assert isinstance(b64_output, str)
    assert len(b64_output) > 100

    # Decodes back to valid image
    decoded_bytes = base64.b64decode(b64_output)
    result_img = Image.open(io.BytesIO(decoded_bytes))
    assert result_img.size == (400, 300)


def test_llm_evaluator_offline_fallback():
    """When LLM is not configured, evaluate_with_llm returns None and regex engine evaluates cleanly."""
    with patch.dict(os.environ, {"LLM_BACKEND": "none", "GROQ_API_KEY": ""}):
        evaluator = LLMComplianceEvaluator()
        assert evaluator.is_available() is False

        ocr_res = OCRScanResult(
            success=True,
            image_metadata=ImageMetadata(width=500, height=500, channels=3),
            total_text_blocks=1,
            text_blocks=[
                TextBlock(
                    id=1,
                    text="MRP Rs. 100.00 (INCL. OF ALL TAXES)",
                    confidence=0.98,
                    polygon=[[10, 10], [200, 10], [200, 30], [10, 30]],
                    bbox=BBox(x_min=10, y_min=10, x_max=200, y_max=30),
                    size=BlockSize(width=190, height=20, aspect_ratio=9.5, estimated_font_size_px=20),
                    center=Point(x=105, y=20)
                )
            ],
            raw_text="MRP Rs. 100.00 (INCL. OF ALL TAXES)",
            processing_time_ms=1.0
        )

        res = evaluator.evaluate_with_llm(ocr_res, "general", {})
        assert res is None  # Clean offline fallback!


def test_mock_groq_llm_evaluation():
    """Test full Groq LLM evaluation flow with mocked API response."""
    mock_groq_response = {
        "choices": [
            {
                "message": {
                    "content": json.dumps({
                        "category": "food",
                        "overall_result": "PASS",
                        "compliance_score": 100.0,
                        "summary": "Packaged food item meets all Legal Metrology and FSSAI declarations.",
                        "evaluations": [
                            {
                                "rule_id": "mrp",
                                "status": "PASS",
                                "extracted_value": "₹50.00",
                                "exact_quote": "MRP Rs. 50.00 (INCL. OF ALL TAXES)",
                                "violation_type": None,
                                "severity": None,
                                "explanation": "Includes statutory tax clause."
                            },
                            {
                                "rule_id": "fssai_license",
                                "status": "PASS",
                                "extracted_value": "10012022000123",
                                "exact_quote": "FSSAI Lic. No. 10012022000123",
                                "violation_type": None,
                                "severity": None,
                                "explanation": "Valid 14-digit FSSAI license number."
                            }
                        ]
                    })
                }
            }
        ]
    }

    ocr_res = OCRScanResult(
        success=True,
        image_metadata=ImageMetadata(width=600, height=400, channels=3),
        total_text_blocks=2,
        text_blocks=[
            TextBlock(
                id=1,
                text="MRP Rs. 50.00 (INCL. OF ALL TAXES)",
                confidence=0.98,
                polygon=[[10, 10], [250, 10], [250, 30], [10, 30]],
                bbox=BBox(x_min=10, y_min=10, x_max=250, y_max=30),
                size=BlockSize(width=240, height=20, aspect_ratio=12.0, estimated_font_size_px=20),
                center=Point(x=130, y=20)
            ),
            TextBlock(
                id=2,
                text="FSSAI Lic. No. 10012022000123",
                confidence=0.95,
                polygon=[[10, 50], [250, 50], [250, 70], [10, 70]],
                bbox=BBox(x_min=10, y_min=50, x_max=250, y_max=70),
                size=BlockSize(width=240, height=20, aspect_ratio=12.0, estimated_font_size_px=20),
                center=Point(x=130, y=60)
            )
        ],
        raw_text="MRP Rs. 50.00 (INCL. OF ALL TAXES)\nFSSAI Lic. No. 10012022000123",
        processing_time_ms=5.0
    )

    ruleset = {
        "mandatory_declarations": [
            {"id": "mrp", "field_name": "Maximum Retail Price (MRP)"},
            {"id": "fssai_license", "field_name": "FSSAI License Number"}
        ],
        "exemptions": []
    }

    with patch.dict(os.environ, {"GROQ_API_KEY": "gsk_test_mock_key", "LLM_BACKEND": "groq", "GROQ_MODEL": "qwen-2.5-32b"}):
        evaluator = LLMComplianceEvaluator()
        assert evaluator.is_available() is True

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_groq_response

        with patch("httpx.Client.post", return_value=mock_resp):
            result = evaluator.evaluate_with_llm(ocr_res, "food", ruleset)

            assert result is not None
            assert result.overall_result == "PASS"
            assert result.compliance_score == 100.0
            found_ids = [d.id for d in result.summary.what_was_found]
            assert "mrp" in found_ids
            assert "fssai_license" in found_ids
