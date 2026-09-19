import os
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("database")

# Get database URL from environment or default to local SQLite database file
DEFAULT_SQLITE_URL = "sqlite:///./label_lens.db"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

try:
    engine = create_engine(
        DATABASE_URL,
        connect_args=connect_args,
        pool_pre_ping=True
    )
    logger.info(f"Database engine initialized using dialect: {engine.dialect.name}")
except Exception as e:
    logger.error(f"Failed to create database engine for URL '{DATABASE_URL}': {e}")
    # Fallback to local SQLite if PostgreSQL connection string fails
    DATABASE_URL = DEFAULT_SQLITE_URL
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False}, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """
    FastAPI dependency that yields a SQLAlchemy database session per request
    and ensures clean closure.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """
    Creates all defined database tables in the target database and migrates missing columns.
    """
    Base.metadata.create_all(bind=engine)
    # Lightweight schema auto-migration for newly added columns
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        if "violations" in inspector.get_table_names():
            existing_cols = [c["name"] for c in inspector.get_columns("violations")]
            new_columns = {
                "citation": "JSON",
                "detected_on_package": "TEXT",
                "expected_on_package": "TEXT",
                "package_element": "TEXT",
            }
            with engine.connect() as conn:
                for col_name, col_type in new_columns.items():
                    if col_name not in existing_cols:
                        conn.execute(text(f"ALTER TABLE violations ADD COLUMN {col_name} {col_type}"))
                        logger.info("Schema migration: added column '%s' to violations table.", col_name)
                conn.commit()
    except Exception as e:
        logger.warning(f"Database schema auto-migration warning: {e}")
