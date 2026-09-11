from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import engine, get_db, init_db
from services.rule_loader import sync_rules_to_db
from routers.ocr import router as ocr_router
from routers.compliance import router as compliance_router
from routers.uploads import router as uploads_router
from routers.video import router as video_router
from routers.demo import router as demo_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database schema tables on startup
    init_db()
    # Sync rules.json to database rules table
    sync_rules_to_db()
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
# Configure CORS for Web & Mobile Clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(ocr_router)
app.include_router(compliance_router)
app.include_router(uploads_router)
app.include_router(video_router)
app.include_router(demo_router)

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

@app.get("/health/db", tags=["Health"])
def db_health_check(db: Session = Depends(get_db)):
    """
    Checks database connection status and returns dialect (PostgreSQL / SQLite).
    """
    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "healthy",
            "database_connected": True,
            "dialect": engine.dialect.name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database connection error: {str(e)}")
