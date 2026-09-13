import pytest
import os
import sys
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure server root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Base, get_db
from models import Product, Inspection, Violation
from models.rule import ComplianceRule
from services.rule_loader import sync_rules_to_db, get_rules_for_category
from services.compliance_evaluator import evaluate_label_compliance
from schemas.ocr import OCRScanResult, TextBlock, BoundingBox, BlockSize, ImageMetadata
from main import app

TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=test_engine)
    db = TestingSessionLocal()
    sync_rules_to_db(db=db)
    db.close()
    app.dependency_overrides[get_db] = override_get_db
    yield
    Base.metadata.drop_all(bind=test_engine)
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    return TestClient(app)


def make_test_ocr(blocks_text: list[str]) -> OCRScanResult:
    text_blocks = []
    for i, t in enumerate(blocks_text):
        text_blocks.append(
            TextBlock(
                id=i,
                text=t,
                confidence=0.95,
                bbox=BoundingBox(x_min=10, y_min=10 + i * 30, x_max=400, y_max=35 + i * 30),
                size=BlockSize(width_px=390, height_px=25, estimated_font_size_px=14.0)
            )
        )
    return OCRScanResult(
        success=True,
        image_metadata=ImageMetadata(width=800, height=1200, channels=3),
        total_blocks=len(text_blocks),
        text_blocks=text_blocks,
        full_text=" \n".join(blocks_text),
        processing_time_ms=10.0
    )


def test_rules_endpoint_category_filtering(client):
    """GET /api/v1/compliance/rules respects category parameter."""
    # General: only base Legal Metrology rules
    res_general = client.get("/api/v1/compliance/rules?category=general")
    assert res_general.status_code == 200
    data_general = res_general.json()
    assert data_general["category"] == "general"
    assert len(data_general["mandatory_declarations"]) == 7

    # Food: base + food declarations + exemptions
    res_food = client.get("/api/v1/compliance/rules?category=food")
    assert res_food.status_code == 200
    data_food = res_food.json()
    assert data_food["category"] == "food"
    assert len(data_food["mandatory_declarations"]) == 10
    rule_ids = [r["id"] for r in data_food["mandatory_declarations"]]
    assert "fssai_license" in rule_ids
    assert "veg_nonveg_symbol" in rule_ids
    assert "nutritional_info" in rule_ids
    assert len(data_food["exemptions"]) > 0

    # Cosmetics: base + cosmetics declarations
    res_cosmetics = client.get("/api/v1/compliance/rules?category=cosmetics")
    assert res_cosmetics.status_code == 200
    data_cosmetics = res_cosmetics.json()
    assert data_cosmetics["category"] == "cosmetics"
    cosm_ids = [r["id"] for r in data_cosmetics["mandatory_declarations"]]
    assert "ingredients_list" in cosm_ids
    assert "batch_number" in cosm_ids

    # Textile: base + textile declarations
    res_textile = client.get("/api/v1/compliance/rules?category=textile")
    assert res_textile.status_code == 200
    data_textile = res_textile.json()
    assert data_textile["category"] == "textile"
    textile_ids = [r["id"] for r in data_textile["mandatory_declarations"]]
    assert "fiber_composition" in textile_ids

    # Electronics: base + electronics declarations
    res_elec = client.get("/api/v1/compliance/rules?category=electronics")
    assert res_elec.status_code == 200
    data_elec = res_elec.json()
    assert data_elec["category"] == "electronics"
    elec_ids = [r["id"] for r in data_elec["mandatory_declarations"]]
    assert "voltage_rating" in elec_ids
    assert "bis_crs_mark" in elec_ids


def test_evaluate_ocr_food_category(client):
    """POST /api/v1/compliance/evaluate-ocr evaluates food declarations."""
    ocr_data = make_test_ocr([
        "MRP Rs. 50.00 (INCL. OF ALL TAXES)",
        "Net Qty: 100g",
        "Mfg Date: 05/2024",
        "Consumer Care: support@sample.com / 1800-123-4567",
        "Manufactured by: Test Foods Pvt Ltd, Industrial Area, Mumbai 400001",
        "Country of Origin: India",
        "FSSAI Lic. No. 10012022000123",
        "100% Vegetarian",
        "Nutritional Information per 100g: Energy 450 kcal, Protein 8g, Carbs 60g"
    ])

    response = client.post(
        "/api/v1/compliance/evaluate-ocr?category=food",
        json=ocr_data.model_dump()
    )
    assert response.status_code == 200
    result = response.json()

    found_ids = [d["id"] for d in result["summary"]["what_was_found"]]
    assert "mrp" in found_ids
    assert "net_quantity" in found_ids
    assert "fssai_license" in found_ids
    assert "veg_nonveg_symbol" in found_ids
    assert "nutritional_info" in found_ids
    assert result["overall_result"] == "PASS"


def test_small_pack_exemption_food(client):
    """Food package < 10g should exempt nutritional_info."""
    ocr_data = make_test_ocr([
        "MRP Rs. 5.00 (INCL. OF ALL TAXES)",
        "Net Qty: 8g",  # Under 10g threshold
        "Mfg Date: 05/2024",
        "Consumer Care: support@sample.com / 1800-123-4567",
        "Manufactured by: Test Candies Pvt Ltd, Delhi 110001",
        "Country of Origin: India",
        "FSSAI Lic. No. 10012022000123",
        "Vegetarian"
        # Notice: NO nutritional_info provided
    ])

    response = client.post(
        "/api/v1/compliance/evaluate-ocr?category=food",
        json=ocr_data.model_dump()
    )
    assert response.status_code == 200
    result = response.json()

    missing_ids = [d["id"] for d in result["summary"]["whats_missing"]]
    # nutritional_info must NOT be in whats_missing because of <10g exemption!
    assert "nutritional_info" not in missing_ids
    assert result["overall_result"] == "PASS"


def test_product_category_resolution(client):
    """POST /api/v1/compliance/evaluate-ocr resolves category from product_id."""
    db = TestingSessionLocal()
    test_prod = Product(
        id="prod-electronics-001",
        brand_name="ElectroSound",
        commodity_name="Bluetooth Speaker",
        category="electronics"
    )
    db.add(test_prod)
    db.commit()
    db.close()

    ocr_data = make_test_ocr([
        "MRP Rs. 999.00 (INCL. OF ALL TAXES)",
        "Net Qty: 1 Unit",
        "Mfg Date: 03/2024",
        "Consumer Care: care@electrosound.com / 1800-111-2222",
        "Manufactured by: SoundTech Pvt Ltd, Bangalore 560001",
        "Country of Origin: India",
        "Rated Voltage: 220-240V AC 50Hz, Power: 10W",
        "BIS Registration No. R-41000000"
    ])

    # No category param specified, only product_id
    response = client.post(
        f"/api/v1/compliance/evaluate-ocr?product_id={test_prod.id}",
        json=ocr_data.model_dump()
    )
    assert response.status_code == 200
    result = response.json()

    found_ids = [d["id"] for d in result["summary"]["what_was_found"]]
    assert "voltage_rating" in found_ids
    assert "bis_crs_mark" in found_ids
    assert result["overall_result"] == "PASS"


def test_direct_compliance_evaluator_category():
    """evaluate_label_compliance() correctly handles category parameter."""
    ocr_data = make_test_ocr([
        "MRP Rs. 150.00 (INCL. OF ALL TAXES)",
        "Net Qty: 50ml",
        "Mfg Date: 02/2024",
        "Consumer Care: care@luxe.com / 1800-000-0000",
        "Manufactured by: Luxe Cosmetics Ltd, Mumbai 400001",
        "Country of Origin: India",
        "Ingredients: Aqua, Glycerin, Niacinamide, Fragrance",
        "Batch No: B123456",
        "Expiry Date: 02/2026"
    ])

    db = TestingSessionLocal()
    result = evaluate_label_compliance(ocr_data, db=db, category="cosmetics")
    db.close()

    found_ids = [d.id for d in result.summary.what_was_found]
    assert "ingredients_list" in found_ids
    assert "batch_number" in found_ids
    assert "expiry_date" in found_ids
    assert result.overall_result == "PASS"
