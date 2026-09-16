import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from database import Base

class Violation(Base):
    __tablename__ = "violations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    inspection_id = Column(String(36), ForeignKey("inspections.id"), nullable=False, index=True)
    rule_code = Column(String(50), nullable=False, index=True)  # e.g., RULE_6_MRP, RULE_6_NET_QTY, FONT_SIZE
    severity = Column(String(20), default="MAJOR", nullable=False) # CRITICAL, MAJOR, MINOR
    title = Column(String(150), nullable=False)
    description = Column(String(500), nullable=False)
    evidence_bbox = Column(JSON, nullable=True) # Bounding box coordinates on image
    citation = Column(JSON, nullable=True) # Official Act, Rule, and statutory quote
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    inspection = relationship("Inspection", back_populates="violations")
