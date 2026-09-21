import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime
from database import Base

class Product(Base):
    __tablename__ = "products"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    barcode = Column(String(50), index=True, nullable=True)
    brand_name = Column(String(100), index=True, nullable=True)
    commodity_name = Column(String(150), nullable=True)
    manufacturer_name = Column(String(200), nullable=True)
    category = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
