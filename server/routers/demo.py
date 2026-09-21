from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_db
from services.replay import get_demo_scan, list_demo_scans

router = APIRouter(prefix="/api/v1/demo", tags=["Demo Replay"])


@router.get("/scans")
def list_scans(
    limit: int | None = Query(default=None, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Replayable captures, best-looking first. Summaries only - no OCR payloads, so the
    picker list stays small."""
    scans = list_demo_scans(db, limit=limit)
    return {"scans": scans, "count": len(scans)}


@router.get("/scans/{demo_id}")
def get_scan(demo_id: str, db: Session = Depends(get_db)):
    """Every face of one capture, each in the same shape GET /uploads/{scan_id} returns,
    so the app can reuse its existing result adapter verbatim."""
    scan = get_demo_scan(db, demo_id)
    if scan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Demo scan not found.",
        )
    return scan
