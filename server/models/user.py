import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Enum
import enum
from database import Base

class UserRole(str, enum.Enum):
    FIELD_INSPECTOR = "FIELD_INSPECTOR"
    DISTRICT_OFFICER = "DISTRICT_OFFICER"
    STATE_CONTROLLER = "STATE_CONTROLLER"
    ADMIN = "ADMIN"

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    full_name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    role = Column(String(30), default=UserRole.FIELD_INSPECTOR.value, nullable=False)
    district = Column(String(100), nullable=True, index=True)
    state = Column(String(100), nullable=True, index=True)
    badge_number = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
