import base64
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from services.video_processing import CHECKPOINT_PATH, UniversalLabelExtractor

router = APIRouter(prefix="/api/v1/video", tags=["Video Processing"])
_unwrapper = None


def get_unwrapper():
    global _unwrapper
    if _unwrapper is None:
        _unwrapper = UniversalLabelExtractor()
    return _unwrapper


def process_video(video_path: str, output_dir: str):
    return get_unwrapper().process_input(video_path, output_dir)


@router.post("/unwrap")
async def video_unwrap(file: UploadFile = File(...)):
    filename = file.filename or "upload.mp4"
    extension = Path(filename).suffix.lower()
    allowed_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
    if extension not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported format '{extension}'. Allowed: {', '.join(allowed_extensions)}",
        )

    video_bytes = await file.read()
    if not video_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded video is empty.")

    if not CHECKPOINT_PATH.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "SAM2 checkpoint missing. Run: python scripts/download_checkpoint.py "
                f"(expected at {CHECKPOINT_PATH})"
            ),
        )

    with tempfile.TemporaryDirectory() as temp_dir:
        video_path = Path(temp_dir) / f"input{extension}"
        video_path.write_bytes(video_bytes)
        output_dir = Path(temp_dir) / "extracted_faces"
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            image_paths = await run_in_threadpool(process_video, str(video_path), str(output_dir))
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Video processing failed: {error}",
            ) from error

        if not image_paths:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No label faces were detected in the video.",
            )

        frames = []
        for idx, image_path in enumerate(image_paths):
            path = Path(image_path)
            if path.exists():
                image_data = path.read_bytes()
                frames.append({
                    "frame_index": idx,
                    "filename": path.name,
                    "image_base64": base64.b64encode(image_data).decode("utf-8"),
                    "content_type": "image/png",
                    "size_bytes": len(image_data),
                })

        return {"success": True, "count": len(frames), "frames": frames}
