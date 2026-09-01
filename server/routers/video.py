import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from database import SessionLocal, get_db
from models import Inspection
from services.cloudinary_service import upload_image as upload_image_to_cloudinary
from routers.uploads import _process_scan
from services.replay import serialize_inspection as _serialize_inspection_result
from services.video_processing import UniversalLabelExtractor


router = APIRouter(
    prefix="/api/v1/video",
    tags=["Video Processing"],
)

SERVER_DIR = Path(__file__).resolve().parents[1]
VIDEO_OUTPUT_DIR = SERVER_DIR / "video_outputs"

_unwrapper = None


def get_unwrapper():
    global _unwrapper

    if _unwrapper is None:
        _unwrapper = UniversalLabelExtractor()

    return _unwrapper


def process_video(video_path: str, output_dir: str):
    return get_unwrapper().process_input(video_path, output_dir)


@router.get("/frames")
def list_video_frame_scans(db: Session = Depends(get_db)):
    inspections = (
        db.query(Inspection)
        .filter(Inspection.image_path.isnot(None))
        .order_by(Inspection.created_at.desc())
        .all()
    )
    images = [_serialize_inspection_result(inspection) for inspection in inspections]
    return {"images": images, "count": len(images)}


@router.get("/frames/{scan_id}")
def get_video_frame_result(scan_id: str, db: Session = Depends(get_db)):
    inspection = db.get(Inspection, scan_id)
    if inspection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video scan not found.",
        )
    return _serialize_inspection_result(inspection)


@router.get("/{scan_id}")
def get_video_result(scan_id: str, db: Session = Depends(get_db)):
    return get_video_frame_result(scan_id=scan_id, db=db)


@router.get("/image/{scan_id}")
def get_video_image_result(scan_id: str, db: Session = Depends(get_db)):
    return get_video_result(scan_id=scan_id, db=db)


@router.post("/frames", status_code=status.HTTP_202_ACCEPTED)
async def video_to_frames(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    file: UploadFile = File(...)
):
    filename = file.filename or "upload.mp4"
    extension = Path(filename).suffix.lower()

    allowed_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}

    if extension not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported format.",
        )

    video_bytes = await file.read()

    if not video_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded video is empty.",
        )

    request_id = str(uuid4())
    output_dir = VIDEO_OUTPUT_DIR / request_id
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as temp_dir:
        video_path = Path(temp_dir) / f"input{extension}"
        video_path.write_bytes(video_bytes)

        try:
            image_paths = await run_in_threadpool(
                process_video,
                str(video_path),
                str(output_dir),
            )
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Video processing failed: {error}",
            )

    if not image_paths:
        output_dir.rmdir()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No label faces were detected in the video.",
        )

    results = []
    for image_path in image_paths:
        frame_bytes = Path(image_path).read_bytes()
        selected_filename = Path(image_path).name or "label_frame.jpg"

        inspection = Inspection(status="PROCESSING")

        try:
            db.add(inspection)
            db.commit()
            db.refresh(inspection)
        except Exception:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not create the video scan record.",
            )

        try:
            cloudinary_image = upload_image_to_cloudinary(
                frame_bytes,
                selected_filename,
                public_id=f"video_scan_{inspection.id}",
            )
        except Exception as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not upload extracted video frame to Cloudinary: {exc}",
            ) from exc

        inspection.image_path = cloudinary_image["secure_url"]

        try:
            db.commit()
        except Exception:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not update the video scan record with the Cloudinary URL.",
            )

        background_tasks.add_task(_process_scan, inspection.id, frame_bytes)

        results.append({
            "scan_id": inspection.id,
            "filename": selected_filename,
            "url": f"/video-files/{request_id}/{selected_filename}",
            "image_url": cloudinary_image["secure_url"],
            "cloudinary_public_id": cloudinary_image["public_id"],
            "status": inspection.status,
        })
    return {"images": results, "count": len(results)}


@router.post("/image", status_code=status.HTTP_202_ACCEPTED)
async def video_upload_image(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
):
    return await video_to_frames(background_tasks=background_tasks, db=db, file=file)