import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from database import Base

class Inspection(Base):
    __tablename__ = "inspections"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    product_id = Column(String(36), ForeignKey("products.id"), nullable=True, index=True)
    category = Column(String(50), nullable=True, index=True)
    inspector_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    image_path = Column(String(255), nullable=True)
    annotated_image_path = Column(String(255), nullable=True)
    
    # Store complete raw OCR extraction from Task 1
    raw_ocr_output = Column(JSON, nullable=True)
    
    # Store categorized Legal Metrology declarations (MRP, Net Qty, Mfg Date, Address)
    extracted_declarations = Column(JSON, nullable=True)
    
    compliance_score = Column(Float, default=100.0, nullable=False)
    status = Column(String(30), default="COMPLIANT", nullable=False, index=True) # COMPLIANT, NON_COMPLIANT, PENDING_REVIEW
    
    location_lat = Column(Float, nullable=True)
    location_lng = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    violations = relationship("Violation", back_populates="inspection", cascade="all, delete-orphan")
