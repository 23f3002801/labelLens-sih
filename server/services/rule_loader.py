import os
import json
import logging
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from models.rule import ComplianceRule
from database import SessionLocal

logger = logging.getLogger("rule_loader")

RULES_FILE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "rules.json")


def load_rules_from_file() -> Dict[str, Any]:
    """Reads rules.json containing base and category-specific rules."""
    if not os.path.exists(RULES_FILE_PATH):
        logger.warning(f"rules.json not found at {RULES_FILE_PATH}. Using fallback defaults.")
        return get_default_ruleset()

    try:
        with open(RULES_FILE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Normalize legacy rules.json if present
        if "mandatory_declarations" in data and "base_declarations" not in data:
            data["base_declarations"] = data["mandatory_declarations"]
            data["categories"] = {}

        return data
    except Exception as e:
        logger.error(f"Failed to parse rules.json: {e}")
        return get_default_ruleset()


def get_default_ruleset() -> Dict[str, Any]:
    """Default fallback ruleset if rules.json is missing or corrupted."""
    return {
        "ruleset_version": "2.0",
        "country_scope": "India",
        "governing_law": "Legal Metrology (Packaged Commodities) Rules, 2011",
        "base_declarations": [
            {
                "id": "manufacturer_details",
                "field_name": "Manufacturer Name & Address",
                "description": "Name and complete address of manufacturer/packer/importer.",
                "required": True,
                "expected_format": "Company Name, Address with Pincode",
                "min_font_size_mm": 1.0,
                "detection_type": "text"
            },
            {
                "id": "net_quantity",
                "field_name": "Net Quantity",
                "description": "Standard weight, volume, or number in metric SI units.",
                "required": True,
                "expected_format": "Numeric value with metric units (e.g., g, kg, ml, L, N)",
                "min_font_size_mm": 1.5,
                "detection_type": "text"
            },
            {
                "id": "mrp",
                "field_name": "Maximum Retail Price (MRP)",
                "description": "MRP inclusive of all taxes.",
                "required": True,
                "expected_format": "MRP Rs X.XX (incl. of all taxes) or ₹ X.XX",
                "min_font_size_mm": 1.0,
                "detection_type": "text"
            },
            {
                "id": "unit_sale_price",
                "field_name": "Unit Sale Price",
                "description": "Price per unit quantity (g, kg, ml, L, or piece).",
                "required": True,
                "expected_format": "₹ X.XX / g or ₹ X.XX / ml",
                "min_font_size_mm": 1.0,
                "detection_type": "text"
            },
            {
                "id": "manufacture_date",
                "field_name": "Month and Year of Manufacture",
                "description": "Date or month/year of manufacture or packing.",
                "required": True,
                "expected_format": "MM/YYYY or MM-YYYY",
                "min_font_size_mm": 1.0,
                "detection_type": "text"
            },
            {
                "id": "consumer_care",
                "field_name": "Consumer Care Details",
                "description": "Helpline number, email, and address for complaints.",
                "required": True,
                "expected_format": "Phone/Email/Address",
                "min_font_size_mm": 1.0,
                "detection_type": "text"
            },
            {
                "id": "country_of_origin",
                "field_name": "Country of Origin",
                "description": "Country where the product was produced.",
                "required": True,
                "expected_format": "Country name (e.g., Made in India)",
                "min_font_size_mm": 1.0,
                "detection_type": "text"
            }
        ],
        "categories": {}
    }


def get_rules_for_category(category: Optional[str] = "general", db: Session = None) -> Dict[str, Any]:
    """
    Returns base Legal Metrology rules merged with category-specific rules.
    If category is 'general', None, or unknown, returns only base rules.
    If category is 'all', returns all rules across all categories.
    """
    normalized_category = (category or "general").strip().lower()

    close_db_on_exit = False
    if db is None:
        try:
            db = SessionLocal()
            close_db_on_exit = True
        except Exception as err:
            logger.warning(f"Could not open DB session to load rules: {err}. Falling back to file.")
            return _filter_rules_from_file(normalized_category)

    try:
        # Check if DB has any rules
        has_any = db.query(ComplianceRule.id).first()
        if not has_any:
            logger.info("No rules found in database. Triggering auto-seeding...")
            sync_rules_to_db(db=db)

        # Build query based on category
        query = db.query(ComplianceRule)
        if normalized_category == "all":
            rules_in_db = query.all()
        elif normalized_category in ("general", "base", ""):
            rules_in_db = query.filter(ComplianceRule.category == "base").all()
        else:
            rules_in_db = query.filter(
                or_(
                    ComplianceRule.category == "base",
                    ComplianceRule.category == normalized_category
                )
            ).all()

        if not rules_in_db:
            logger.warning(f"No rules found in DB for category '{normalized_category}'. Falling back to file.")
            return _filter_rules_from_file(normalized_category)

        # Load exemptions for this category from rules.json
        file_data = load_rules_from_file()
        cat_info = file_data.get("categories", {}).get(normalized_category, {})
        exemptions = cat_info.get("exemptions", [])

        declarations = []
        for r in rules_in_db:
            declarations.append({
                "id": r.id,
                "category": r.category,
                "field_name": r.field_name,
                "description": r.description or "",
                "required": r.required,
                "expected_format": r.expected_format or "",
                "min_font_size_mm": r.min_font_size_mm,
                "regex_pattern": r.regex_pattern or "",
                "detection_type": getattr(r, "detection_type", "text") or "text"
            })

        return {
            "ruleset_version": file_data.get("ruleset_version", "2.0"),
            "country_scope": file_data.get("country_scope", "India"),
            "category": normalized_category,
            "category_name": cat_info.get("name", normalized_category.capitalize()),
            "governing_law": cat_info.get("governing_law", file_data.get("governing_law", "Legal Metrology Act")),
            "mandatory_declarations": declarations,
            "exemptions": exemptions
        }
    except Exception as e:
        logger.error(f"Error querying rules from DB: {e}. Falling back to file.")
        return _filter_rules_from_file(normalized_category)
    finally:
        if close_db_on_exit and db is not None:
            db.close()


def _filter_rules_from_file(category: str) -> Dict[str, Any]:
    """Helper fallback: extracts base + category rules directly from rules.json."""
    data = load_rules_from_file()
    base_rules = data.get("base_declarations", data.get("mandatory_declarations", []))
    for r in base_rules:
        r.setdefault("category", "base")
        r.setdefault("detection_type", "text")

    merged_declarations = list(base_rules)
    exemptions = []
    cat_info = {}

    if category not in ("general", "base", "all"):
        cat_data = data.get("categories", {}).get(category, {})
        cat_info = cat_data
        cat_rules = cat_data.get("declarations", [])
        for r in cat_rules:
            r.setdefault("category", category)
            r.setdefault("detection_type", "text")
        merged_declarations.extend(cat_rules)
        exemptions = cat_data.get("exemptions", [])
    elif category == "all":
        for c_key, c_val in data.get("categories", {}).items():
            cat_rules = c_val.get("declarations", [])
            for r in cat_rules:
                r.setdefault("category", c_key)
                r.setdefault("detection_type", "text")
            merged_declarations.extend(cat_rules)

    return {
        "ruleset_version": data.get("ruleset_version", "2.0"),
        "country_scope": data.get("country_scope", "India"),
        "category": category,
        "category_name": cat_info.get("name", category.capitalize()),
        "governing_law": cat_info.get("governing_law", data.get("governing_law", "")),
        "mandatory_declarations": merged_declarations,
        "exemptions": exemptions
    }


def get_rules_from_db(db: Session = None, category: Optional[str] = "general") -> Dict[str, Any]:
    """
    Backwards-compatible wrapper. Calls get_rules_for_category().
    """
    return get_rules_for_category(category=category, db=db)


def sync_rules_to_db(db: Session = None, force_update: bool = False):
    """
    Seeds rules from rules.json into database table 'compliance_rules'.
    Inserts both base_declarations (category='base') and categories declarations.
    If force_update is True, existing rules will be updated with values from rules.json.
    """
    close_db_on_exit = False
    if db is None:
        db = SessionLocal()
        close_db_on_exit = True

    try:
        existing_rules = {r.id: r for r in db.query(ComplianceRule).all()}
        if existing_rules and not force_update:
            logger.info(f"Compliance rules already seeded ({len(existing_rules)} rules found in DB). Skipping re-seeding.")
            return

        rules_data = load_rules_from_file()

        # Collect all items to sync with their respective category
        items_to_sync: List[tuple] = []

        # 1. Base declarations
        base_declarations = rules_data.get("base_declarations", rules_data.get("mandatory_declarations", []))
        for item in base_declarations:
            items_to_sync.append(("base", item))

        # 2. Category-specific declarations
        categories = rules_data.get("categories", {})
        for cat_key, cat_val in categories.items():
            for item in cat_val.get("declarations", []):
                items_to_sync.append((cat_key, item))

        for cat_name, item in items_to_sync:
            rule_id = item["id"]
            if rule_id in existing_rules and force_update:
                rule_obj = existing_rules[rule_id]
                rule_obj.category = cat_name
                rule_obj.field_name = item.get("field_name", rule_id)
                rule_obj.description = item.get("description", "")
                rule_obj.required = item.get("required", True)
                rule_obj.expected_format = item.get("expected_format", "")
                rule_obj.min_font_size_mm = item.get("min_font_size_mm", 1.0)
                rule_obj.regex_pattern = item.get("regex_pattern", "")
                rule_obj.detection_type = item.get("detection_type", "text")
            elif rule_id not in existing_rules:
                rule_obj = ComplianceRule(
                    id=rule_id,
                    category=cat_name,
                    field_name=item.get("field_name", rule_id),
                    description=item.get("description", ""),
                    required=item.get("required", True),
                    expected_format=item.get("expected_format", ""),
                    min_font_size_mm=item.get("min_font_size_mm", 1.0),
                    regex_pattern=item.get("regex_pattern", ""),
                    detection_type=item.get("detection_type", "text")
                )
                db.add(rule_obj)

        db.commit()
        logger.info(f"Compliance rules synchronized to database successfully ({len(items_to_sync)} rules processed).")
    except Exception as e:
        logger.error(f"Error seeding rules to DB: {e}")
        db.rollback()
    finally:
        if close_db_on_exit:
            db.close()


def export_db_rules_to_file(db: Session = None) -> bool:
    """
    Exports current active DB compliance rules back to rules.json file.
    Groups rules by category='base' vs category-specific.
    """
    close_db_on_exit = False
    if db is None:
        db = SessionLocal()
        close_db_on_exit = True

    try:
        rules_in_db = db.query(ComplianceRule).all()
        base_declarations = []
        categories: Dict[str, Dict[str, Any]] = {}

        existing_file_data = load_rules_from_file()

        for r in rules_in_db:
            item = {
                "id": r.id,
                "field_name": r.field_name,
                "description": r.description or "",
                "required": r.required,
                "expected_format": r.expected_format or "",
                "min_font_size_mm": r.min_font_size_mm,
                "detection_type": getattr(r, "detection_type", "text") or "text"
            }
            if r.regex_pattern:
                item["regex_pattern"] = r.regex_pattern

            if r.category == "base":
                base_declarations.append(item)
            else:
                cat_key = r.category
                if cat_key not in categories:
                    # Preserve existing metadata from file if available
                    existing_cat = existing_file_data.get("categories", {}).get(cat_key, {})
                    categories[cat_key] = {
                        "name": existing_cat.get("name", cat_key.capitalize()),
                        "governing_law": existing_cat.get("governing_law", ""),
                        "declarations": [],
                        "exemptions": existing_cat.get("exemptions", [])
                    }
                categories[cat_key]["declarations"].append(item)

        export_data = {
            "ruleset_version": existing_file_data.get("ruleset_version", "2.0"),
            "country_scope": existing_file_data.get("country_scope", "India"),
            "governing_law": existing_file_data.get("governing_law", "Legal Metrology (Packaged Commodities) Rules, 2011"),
            "base_declarations": base_declarations,
            "categories": categories
        }

        with open(RULES_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(export_data, f, indent=2)

        logger.info(f"Exported {len(rules_in_db)} DB rules to {RULES_FILE_PATH}.")
        return True
    except Exception as e:
        logger.error(f"Failed to export DB rules to file: {e}")
        return False
    finally:
        if close_db_on_exit and db is not None:
            db.close()
