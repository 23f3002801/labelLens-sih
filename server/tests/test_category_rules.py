import pytest
import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure server root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Base
from models.rule import ComplianceRule
from services.rule_loader import (
    load_rules_from_file,
    get_rules_for_category,
    get_rules_from_db,
    sync_rules_to_db,
    export_db_rules_to_file
)

TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=test_engine)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


def test_rules_json_structure():
    """Verify rules.json contains base_declarations and all expected categories."""
    rules_data = load_rules_from_file()
    assert "base_declarations" in rules_data
    assert len(rules_data["base_declarations"]) == 7

    assert "categories" in rules_data
    categories = rules_data["categories"]
    assert "food" in categories
    assert "cosmetics" in categories
    assert "textile" in categories
    assert "electronics" in categories

    # Food declarations check
    food_decl = categories["food"]["declarations"]
    food_ids = [d["id"] for d in food_decl]
    assert "fssai_license" in food_ids
    assert "veg_nonveg_symbol" in food_ids
    assert "nutritional_info" in food_ids

    # Veg symbol should be visual detection_type
    veg_rule = next(d for d in food_decl if d["id"] == "veg_nonveg_symbol")
    assert veg_rule["detection_type"] == "visual"

    # Food exemptions
    assert len(categories["food"]["exemptions"]) > 0


def test_sync_rules_to_db(db_session):
    """Verify syncing populates DB with both base and category-scoped rules."""
    sync_rules_to_db(db=db_session, force_update=True)

    all_rules = db_session.query(ComplianceRule).all()
    assert len(all_rules) >= 20  # 7 base + 5 food + 4 cosmetics + 3 textile + 2 electronics = 21

    base_rules = db_session.query(ComplianceRule).filter(ComplianceRule.category == "base").all()
    assert len(base_rules) == 7

    food_rules = db_session.query(ComplianceRule).filter(ComplianceRule.category == "food").all()
    assert len(food_rules) == 5

    # Visual detection check
    veg_db_rule = db_session.query(ComplianceRule).filter(ComplianceRule.id == "veg_nonveg_symbol").first()
    assert veg_db_rule is not None
    assert veg_db_rule.detection_type == "visual"


def test_get_rules_for_category_general(db_session):
    """'general' category should return only 7 base Legal Metrology rules."""
    sync_rules_to_db(db=db_session)
    result = get_rules_for_category(category="general", db=db_session)

    assert result["category"] == "general"
    declarations = result["mandatory_declarations"]
    assert len(declarations) == 7
    for d in declarations:
        assert d["category"] == "base"


def test_get_rules_for_category_food(db_session):
    """'food' category should return 7 base + 5 food rules = 12 total, plus exemptions."""
    sync_rules_to_db(db=db_session)
    result = get_rules_for_category(category="food", db=db_session)

    assert result["category"] == "food"
    declarations = result["mandatory_declarations"]
    assert len(declarations) == 12

    decl_ids = [d["id"] for d in declarations]
    assert "mrp" in decl_ids
    assert "net_quantity" in decl_ids
    assert "fssai_license" in decl_ids
    assert "veg_nonveg_symbol" in decl_ids

    assert len(result["exemptions"]) > 0
    assert result["exemptions"][0]["exempted_rule_ids"] == ["nutritional_info"]


def test_get_rules_for_category_cosmetics(db_session):
    """'cosmetics' category should return 7 base + 4 cosmetic rules = 11 total."""
    sync_rules_to_db(db=db_session)
    result = get_rules_for_category(category="cosmetics", db=db_session)

    assert result["category"] == "cosmetics"
    declarations = result["mandatory_declarations"]
    assert len(declarations) == 11

    decl_ids = [d["id"] for d in declarations]
    assert "mfg_license_no" in decl_ids
    assert "batch_lot_number" in decl_ids


def test_get_rules_for_category_all(db_session):
    """'all' category should return all rules across all categories."""
    sync_rules_to_db(db=db_session)
    result = get_rules_for_category(category="all", db=db_session)

    assert result["category"] == "all"
    assert len(result["mandatory_declarations"]) >= 21


def test_get_rules_from_db_backwards_compatibility(db_session):
    """Existing get_rules_from_db() should work without arguments and default to general."""
    sync_rules_to_db(db=db_session)
    result = get_rules_from_db(db=db_session)

    assert "mandatory_declarations" in result
    assert len(result["mandatory_declarations"]) == 7
