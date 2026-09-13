import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, Float, DateTime
from database import Base

class ComplianceRule(Base):
    __tablename__ = "compliance_rules"

    id = Column(String(50), primary_key=True) # e.g. manufacturer_details, net_quantity, mrp
    category = Column(String(50), default="base", nullable=False, index=True)
    field_name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    required = Column(Boolean, default=True, nullable=False)
    expected_format = Column(String(255), nullable=True)
    min_font_size_mm = Column(Float, default=1.0, nullable=False)
    regex_pattern = Column(String(255), nullable=True)
    detection_type = Column(String(50), default="text", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
