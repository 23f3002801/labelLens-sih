import sys
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

# Ensure server root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
from database import Base, get_db
from models import User, UserRole, Product, Inspection, Violation

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
    """Create fresh isolated tables before each test."""
    Base.metadata.create_all(bind=engine_test)
    yield
    Base.metadata.drop_all(bind=engine_test)

def test_db_health_endpoint():
    """Test GET /health/db endpoint."""
    response = client.get("/health/db")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["database_connected"] is True


def test_create_and_retrieve_inspection_record():
    """Test creating a full inspection record with JSON OCR data."""
    db = TestingSessionLocal()
    try:
        user = User(
            full_name="Inspector Sharma",
            email="sharma@doca.gov.in",
            role=UserRole.FIELD_INSPECTOR.value,
            district="Noida"
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        product = Product(
            barcode="8904063214393",
            brand_name="Haldiram's",
            commodity_name="Aloo Bhujia"
        )
        db.add(product)
        db.commit()
        db.refresh(product)

        sample_ocr_json = {
            "total_text_blocks": 2,
            "text_blocks": [
                {"id": 1, "text": "MRP Rs 250.00 (INCL. OF ALL TAXES)"},
                {"id": 2, "text": "NET QTY: 440g"}
            ]
        }
        
        inspection = Inspection(
            product_id=product.id,
            inspector_id=user.id,
            raw_ocr_output=sample_ocr_json,
            compliance_score=100.0,
            status="COMPLIANT"
        )
        db.add(inspection)
        db.commit()
        db.refresh(inspection)

        fetched = db.query(Inspection).filter(Inspection.id == inspection.id).first()
        assert fetched is not None
        assert fetched.compliance_score == 100.0
        assert fetched.raw_ocr_output["total_text_blocks"] == 2
        assert fetched.raw_ocr_output["text_blocks"][0]["text"] == "MRP Rs 250.00 (INCL. OF ALL TAXES)"

    finally:
        db.close()


def test_upload_image_uses_provided_public_id(monkeypatch):
    """Cloudinary should accept a traceable public_id supplied by the app."""
    import services.cloudinary_service as cloudinary_service

    captured = {}

    def fake_upload(image_bytes, folder, public_id, resource_type):
        captured["public_id"] = public_id
        return {"secure_url": "https://example.com/test.jpg", "public_id": public_id}

    monkeypatch.setattr(cloudinary_service.os, "getenv", lambda key: {
        "CLOUDINARY_CLOUD_NAME": "demo",
        "CLOUDINARY_API_KEY": "123",
        "CLOUDINARY_API_SECRET": "secret",
    }.get(key))
    monkeypatch.setattr(cloudinary_service.cloudinary, "config", lambda **kwargs: None)
    monkeypatch.setattr(cloudinary_service.cloudinary.uploader, "upload", fake_upload)

    result = cloudinary_service.upload_image(b"fake-bytes", "test.jpg", public_id="scan_abc-123")

    assert result["public_id"] == "scan_abc-123"
    assert captured["public_id"] == "scan_abc-123"


def test_background_scan_uses_new_session_for_processing(monkeypatch):
    """Background jobs must open their own DB session instead of reusing the request session."""
    import services.cloudinary_service as cloudinary_service
    from routers import uploads as uploads_module

    class DummyOCRResult:
        success = True
        error = None
        raw_text = "MRP Rs 250.00 (INCL. OF ALL TAXES)\nNET QTY 440 g"
        text_blocks = []
        model_dump = lambda self: {"raw_text": self.raw_text}

    class DummyComplianceResult:
        compliance_score = 96.0
        overall_result = "PASS"
        summary = type("Summary", (), {"what_was_found": [], "whats_wrong": []})()
        structured_result = {
            "compliance_score": 96.0,
            "extracted_declarations": [{"field": "MRP", "value": "Rs 250.00", "status": "COMPLIANT"}],
            "violation_list": [],
            "final_status": "COMPLIANT",
        }

    def fake_upload(image_bytes, filename, public_id=None):
        return {"secure_url": "https://example.com/label.jpg", "public_id": public_id or "scan_demo"}

    monkeypatch.setattr(cloudinary_service, "upload_image", fake_upload)
    monkeypatch.setattr(uploads_module, "get_ocr_service", lambda: type("OCR", (), {"extract_text": lambda self, *args, **kwargs: DummyOCRResult()})())
    monkeypatch.setattr(uploads_module, "evaluate_label_compliance", lambda ocr_result, ruleset=None, db=None: DummyComplianceResult())
    monkeypatch.setattr(uploads_module, "get_rules_from_db", lambda db=None: {"mandatory_declarations": []})
    monkeypatch.setattr(uploads_module, "SessionLocal", TestingSessionLocal)

    db = TestingSessionLocal()
    inspection = Inspection(status="PROCESSING")
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    db.close()

    uploads_module._process_scan(inspection.id, b"fake-image")

    db = TestingSessionLocal()
    saved = db.get(Inspection, inspection.id)
    db.close()

    assert saved.status != "FAILED"


def test_background_scan_handles_pydantic_structured_result(monkeypatch):
    """Structured compliance objects should be converted to plain dicts before JSON storage."""
    from routers import uploads as uploads_module
    from schemas.compliance import StructuredComplianceResult

    class DummyOCRResult:
        success = True
        error = None
        raw_text = "MRP Rs 250.00 (INCL. OF ALL TAXES)"
        text_blocks = []
        model_dump = lambda self: {"raw_text": self.raw_text, "structured_compliance": {}}

    class DummyComplianceResult:
        compliance_score = 70.0
        overall_result = "FAIL"
        summary = type("Summary", (), {"what_was_found": [], "whats_wrong": []})()
        structured_result = StructuredComplianceResult(
            compliance_score=70.0,
            extracted_declarations=[],
            violation_list=[],
            final_status="NON_COMPLIANT",
        )

    monkeypatch.setattr(uploads_module, "get_ocr_service", lambda: type("OCR", (), {"extract_text": lambda self, *args, **kwargs: DummyOCRResult()})())
    monkeypatch.setattr(uploads_module, "evaluate_label_compliance", lambda ocr_result, ruleset=None, db=None: DummyComplianceResult())
    monkeypatch.setattr(uploads_module, "get_rules_from_db", lambda db=None: {"mandatory_declarations": []})
    monkeypatch.setattr(uploads_module, "SessionLocal", TestingSessionLocal)

    db = TestingSessionLocal()
    inspection = Inspection(status="PROCESSING")
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    db.close()

    uploads_module._process_scan(inspection.id, b"fake-image")

    db = TestingSessionLocal()
    saved = db.get(Inspection, inspection.id)
    assert saved.status != "FAILED"
    assert saved.raw_ocr_output["structured_compliance"]["final_status"] == "NON_COMPLIANT"
    db.close()


def test_video_frames_endpoint_returns_images_payload(monkeypatch, tmp_path):
    """The video route should expose the image array the mobile client expects."""
    from routers import video as video_module

    frame_file = tmp_path / "frame_1.png"
    frame_file.write_bytes(b"fake-image-bytes")

    class DummyVideoExtractor:
        def process_input(self, video_path, output_dir):
            return [str(frame_file)]

    def fake_upload(frame_bytes, filename, public_id=None):
        return {"secure_url": "https://example.com/frame.jpg", "public_id": public_id or "video_demo"}

    monkeypatch.setattr(video_module, "get_unwrapper", lambda: DummyVideoExtractor())
    monkeypatch.setattr(video_module, "upload_image_to_cloudinary", fake_upload)

    response = client.post(
        "/api/v1/video/frames",
        files={"file": ("clip.mp4", b"fake-video-data", "video/mp4")},
    )

    assert response.status_code == 202
    data = response.json()
    assert "images" in data
    assert len(data["images"]) == 1
    assert data["images"][0]["scan_id"]
    assert data["images"][0]["image_url"] == "https://example.com/frame.jpg"


def test_video_result_endpoint_returns_saved_scan(monkeypatch):
    """Video scans should be queryable by scan_id like photo scans."""
    db = TestingSessionLocal()
    inspection = Inspection(status="PROCESSING", image_path="https://example.com/video-frame.jpg")
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    db.close()

    response = client.get(f"/api/v1/video/frames/{inspection.id}")

    assert response.status_code == 200
    data = response.json()
    assert data["scan_id"] == inspection.id
    assert data["status"] == "PROCESSING"
    assert data["image_path"] == "https://example.com/video-frame.jpg"
