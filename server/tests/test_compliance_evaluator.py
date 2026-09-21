import sys
import os
import io
import pytest
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
from database import Base, get_db
from services.ocr_service import extract_text_from_image
from services.compliance_evaluator import evaluate_label_compliance, ComplianceEvaluator
from services.rule_loader import get_rules_from_db
from schemas.ocr import OCRScanResult, TextBlock, BBox, BlockSize, Point, ImageMetadata

from sqlalchemy.pool import StaticPool

TEST_SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine_test = create_engine(TEST_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine_test)
    # Seed rules into memory DB
    db = TestingSessionLocal()
    from services.rule_loader import sync_rules_to_db
    sync_rules_to_db(db=db)
    db.close()
    yield
    Base.metadata.drop_all(bind=engine_test)

def create_compliant_label_image() -> bytes:
    img = Image.new("RGB", (600, 400), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((30, 30), "MRP Rs 250.00 (INCL. OF ALL TAXES)", fill=(0, 0, 0))
    draw.text((30, 80), "NET QTY: 440 g", fill=(0, 0, 0))
    draw.text((30, 130), "MFG DATE: 08/2026", fill=(0, 0, 0))
    draw.text((30, 180), "Mfd by: Acme Foods Pvt Ltd, Industrial Area - 110020", fill=(0, 0, 0))
    draw.text((30, 230), "Consumer Care: 0120-2400286, help@acmefoods.com", fill=(0, 0, 0))
    draw.text((30, 280), "PRODUCT OF INDIA", fill=(0, 0, 0))

    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()

def create_non_compliant_label_image() -> bytes:
    img = Image.new("RGB", (600, 400), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    # Missing tax clause in MRP and non-standard unit gms
    draw.text((30, 30), "MRP Rs 250.00", fill=(0, 0, 0))
    draw.text((30, 80), "NET QTY: 500 gms", fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_compliance_evaluator_compliant_label():
    """Test Task #6 Compliance Evaluator on a fully compliant product label."""
    img_bytes = create_compliant_label_image()
    ocr_res = extract_text_from_image(img_bytes)
    
    db = TestingSessionLocal()
    ruleset = get_rules_from_db(db=db)
    comp_res = evaluate_label_compliance(ocr_res, ruleset=ruleset, db=db)
    db.close()

    assert comp_res.total_declarations_required > 0
    assert len(comp_res.summary.what_was_found) > 0
    assert comp_res.overall_result in ["PASS", "FAIL"]


def test_compliance_evaluator_non_compliant_label():
    """Test Task #6 Compliance Evaluator flags missing declarations and format errors."""
    img_bytes = create_non_compliant_label_image()
    ocr_res = extract_text_from_image(img_bytes)
    
    db = TestingSessionLocal()
    ruleset = get_rules_from_db(db=db)
    comp_res = evaluate_label_compliance(ocr_res, ruleset=ruleset, db=db)
    db.close()

    # Should detect violations (missing tax clause, illegal unit 'gms', missing mfg date)
    assert len(comp_res.summary.whats_wrong) > 0
    assert comp_res.overall_result == "FAIL"


def test_evaluate_image_api_endpoint():
    """Test POST /api/v1/compliance/evaluate-image REST API endpoint."""
    img_bytes = create_compliant_label_image()
    
    response = client.post(
        "/api/v1/compliance/evaluate-image",
        files={"file": ("label.jpg", img_bytes, "image/jpeg")}
    )

    assert response.status_code == 200
    data = response.json()
    assert "overall_result" in data
    assert "compliance_score" in data
    assert "summary" in data
    assert "what_was_found" in data["summary"]
    assert "whats_missing" in data["summary"]
    assert "whats_wrong" in data["summary"]



# --- MRP tax-clause matching (Rule 6) ------------------------------------------------
#
# RapidOCR emits one block per detected LINE and frequently glues tightly-set label text
# into a single token, so "(incl. of all taxes)" reaches the evaluator in a lot of shapes.
# Every one of these declares the clause and must NOT be flagged wrong_format.

RULESET = {
    "mandatory_declarations": [
        {"id": "mrp", "field_name": "Maximum Retail Price (MRP)", "required": True, "min_font_size_mm": 1.0},
    ]
}


def _block(block_id, text, top):
    return TextBlock(
        id=block_id,
        text=text,
        confidence=0.95,
        polygon=[[10, top], [300, top], [300, top + 40], [10, top + 40]],
        bbox=BBox(x_min=10, y_min=top, x_max=300, y_max=top + 40),
        size=BlockSize(width=290, height=40, aspect_ratio=7.2, estimated_font_size_px=40),
        center=Point(x=155, y=top + 20),
    )


def _ocr(*lines):
    return OCRScanResult(
        success=True,
        image_metadata=ImageMetadata(width=800, height=1000, channels=3),
        total_text_blocks=len(lines),
        text_blocks=[_block(i + 1, line, 100 + i * 60) for i, line in enumerate(lines)],
        raw_text="\n".join(lines),
        processing_time_ms=1.0,
    )


def _mrp(*lines):
    result = evaluate_label_compliance(_ocr(*lines), ruleset=RULESET)
    found = [d for d in result.summary.what_was_found if d.id == "mrp"]
    return found, result


@pytest.mark.parametrize(
    "lines",
    [
        pytest.param(("MRP Rs 120 (Incl. of all taxes)",), id="same_line"),
        pytest.param(("MRP Rs 120", "(Incl. of all taxes)"), id="clause_on_new_line"),
        pytest.param(("MRP Rs 120 (Incl.", "of all taxes)"), id="clause_split_across_blocks"),
        pytest.param(("MRP Rs.120", "Incl.of all taxes"), id="no_space_after_incl"),
        pytest.param(("M.R.P. 250", "inclusive of all taxes"), id="lowercase_inclusive"),
        pytest.param(("MRPRS250.00(INCL.OFALLTAXES)",), id="glued_single_token"),
        pytest.param(("MRPRS250.00", "(INCL.OFALLTAXES)"), id="glued_clause_own_line"),
    ],
)
def test_mrp_tax_clause_is_accepted(lines):
    found, _ = _mrp(*lines)
    assert len(found) == 1, "MRP must be detected exactly once"
    assert found[0].format_valid, f"tax clause should have been recognized in {lines!r}"
    assert found[0].status == "COMPLIANT"


def test_mrp_without_tax_clause_still_flagged():
    found, result = _mrp("MRP Rs 120")
    assert len(found) == 1
    assert not found[0].format_valid
    assert found[0].status == "FORMAT_ERROR"
    assert any(v.rule_id == "mrp" and v.violation_type == "wrong_format" for v in result.summary.whats_wrong)


def test_mrp_is_not_duplicated_across_blocks():
    """A price line, a bare "MRP" line and a standalone clause line all match the MRP
    detector; they must collapse into one declaration, not three competing ones."""
    found, result = _mrp("MRP Rs 120", "MRP", "(Incl. of all taxes)")
    assert len(found) == 1
    assert found[0].status == "COMPLIANT"
    assert len([v for v in result.summary.whats_wrong if v.rule_id == "mrp"]) == 0


@pytest.mark.parametrize("text", ["CUSTOMERS ONLY", "UNITED FOODS", "NETWORKS INDIA", "PRINCE SNACKS"])
def test_ordinary_words_do_not_match_declarations(text):
    """The despaced fallback must not resurrect the substring false positives it replaced
    - 'RS' inside CUSTOMERS, 'UNIT' inside UNITED, 'WORKS' inside NETWORKS."""
    result = evaluate_label_compliance(_ocr(text), ruleset=RULESET)
    assert result.summary.what_was_found == []
