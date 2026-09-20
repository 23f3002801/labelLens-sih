from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from routers.ocr import router as ocr_router
from routers.compliance import router as compliance_router
from routers.stateless_video import router as video_router

import logging

logger = logging.getLogger("main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(
    title="LabelLens - Legal Metrology Compliance API",
    description="Automated label scanning, OCR text extraction, font size analysis, and Legal Metrology 2011 rule validation engine.",
    version="1.0.0",
    lifespan=lifespan
)

VIDEO_OUTPUT_DIR = Path(__file__).resolve().parent / "video_outputs"
VIDEO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app.mount(
    "/video-files",
    StaticFiles(directory=VIDEO_OUTPUT_DIR),
    name="video-files",
)

STORAGE_UPLOAD_DIR = Path(__file__).resolve().parent / "storage" / "uploads"
STORAGE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app.mount(
    "/uploads",
    StaticFiles(directory=STORAGE_UPLOAD_DIR),
    name="uploads",
)
# Configure CORS for Web & Mobile Clients
# Note: allow_credentials cannot be True when allow_origins is ["*"] per CORS spec.
# Since FastAPI is a stateless compute engine called by the Node server (not browsers
# directly), credentials are not needed here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(ocr_router)
app.include_router(compliance_router)
app.include_router(video_router)

@app.get("/", tags=["Health"])
def read_root():
    return {
        "status": "online",
        "app": "LabelLens API",
        "version": "1.0.0",
        "docs_url": "/docs"
    }

@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "healthy"}

