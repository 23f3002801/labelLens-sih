import os
import sys
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Base
from models import Inspection, Violation
from services.replay import GROUP_GAP_SECONDS, get_demo_scan, list_demo_scans

engine_test = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test)

BASE_TIME = datetime(2026, 9, 1, 12, 0, 0)


@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine_test)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine_test)


def _add(db, *, kind, offset_s, blocks=3, declarations=2, status="NON_COMPLIANT"):
    prefix = "video_scan_" if kind == "video" else "scan_"
    inspection = Inspection(
        status=status,
        image_path=f"https://res.cloudinary.com/x/labellens/scans/{prefix}abc{offset_s}",
        created_at=BASE_TIME + timedelta(seconds=offset_s),
        compliance_score=55.0,
        raw_ocr_output={"text_blocks": [{"text": f"line {i}"} for i in range(blocks)]},
        extracted_declarations=[{"id": f"d{i}"} for i in range(declarations)],
    )
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    return inspection


def test_video_faces_captured_together_form_one_group(db):
    """Frames of one 360 capture are committed seconds apart and must replay as a single
    multi-frame scan, not four separate ones."""
    for offset in (0, 5, 9, 14):
        _add(db, kind="video", offset_s=offset)

    scans = list_demo_scans(db)
    assert len(scans) == 1
    assert scans[0]["frame_count"] == 4
    assert scans[0]["kind"] == "video"


def test_separate_captures_stay_separate(db):
    _add(db, kind="video", offset_s=0)
    _add(db, kind="video", offset_s=int(GROUP_GAP_SECONDS) + 30)

    assert len(list_demo_scans(db)) == 2


def test_photo_after_video_is_its_own_scan(db):
    """A photo taken moments after a video is a different capture, not a fifth face."""
    _add(db, kind="video", offset_s=0)
    _add(db, kind="video", offset_s=5)
    _add(db, kind="photo", offset_s=10)

    scans = list_demo_scans(db)
    assert sorted(s["frame_count"] for s in scans) == [1, 2]
    assert {s["kind"] for s in scans} == {"video", "photo"}


def test_unusable_rows_are_hidden(db):
    """Rows with no image, no OCR text, or still processing can't render as a demo."""
    _add(db, kind="photo", offset_s=0, blocks=0)
    _add(db, kind="photo", offset_s=200, status="PROCESSING")
    good = _add(db, kind="photo", offset_s=400)

    scans = list_demo_scans(db)
    assert len(scans) == 1
    assert scans[0]["demo_id"] == good.id


def test_richest_scans_are_listed_first(db):
    _add(db, kind="photo", offset_s=0, declarations=1)
    rich = _add(db, kind="photo", offset_s=300, declarations=6)

    assert list_demo_scans(db)[0]["demo_id"] == rich.id


def test_get_demo_scan_returns_every_frame_in_full(db):
    lead = _add(db, kind="video", offset_s=0)
    _add(db, kind="video", offset_s=6)
    db.add(
        Violation(
            inspection_id=lead.id,
            rule_code="mrp",
            severity="MAJOR",
            title="Maximum Retail Price (MRP) - WRONG_FORMAT",
            description="missing tax clause",
        )
    )
    db.commit()

    scan = get_demo_scan(db, lead.id)
    assert scan["frame_count"] == 2
    assert len(scan["frames"]) == 2
    # Same shape GET /uploads/{scan_id} returns - the app reuses its adapter on it.
    first = scan["frames"][0]
    assert set(first) >= {"scan_id", "status", "image_path", "ocr_result", "extracted_declarations", "violations"}
    assert first["violations"][0]["rule_code"] == "mrp"


def test_unknown_demo_id_returns_none(db):
    _add(db, kind="photo", offset_s=0)
    assert get_demo_scan(db, "not-a-real-id") is None


def test_group_passes_only_when_every_face_passes(db):
    _add(db, kind="video", offset_s=0, status="COMPLIANT")
    _add(db, kind="video", offset_s=5, status="NON_COMPLIANT")

    assert list_demo_scans(db)[0]["status"] == "NON_COMPLIANT"
