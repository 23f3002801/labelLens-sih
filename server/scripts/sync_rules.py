"""
Manually syncs the compliance_rules table with the current contents of rules.json.

Unlike services.rule_loader.sync_rules_to_db (which only seeds the table once,
on first startup), this script always reconciles the DB with rules.json:
inserts new declarations, updates changed fields on existing ones, and removes
rows for declarations no longer present in the file.

Run whenever rules.json is edited and the change needs to reach the DB:

    cd server
    uv run python scripts/sync_rules.py
"""

import os
import sys
import logging

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sync_rules_script")

from database import SessionLocal, init_db
from models.rule import ComplianceRule
from services.rule_loader import load_rules_from_file


def sync_rules(db):
    rules_data = load_rules_from_file()
    declarations = rules_data.get("mandatory_declarations", [])
    incoming_ids = {item["id"] for item in declarations}

    existing_rules = {r.id: r for r in db.query(ComplianceRule).all()}

    inserted, updated = 0, 0
    for item in declarations:
        rule_id = item["id"]
        existing = existing_rules.get(rule_id)
        if existing is None:
            db.add(ComplianceRule(
                id=rule_id,
                field_name=item.get("field_name", rule_id),
                description=item.get("description", ""),
                required=item.get("required", True),
                expected_format=item.get("expected_format", ""),
                min_font_size_mm=item.get("min_font_size_mm", 1.0)
            ))
            inserted += 1
        else:
            existing.field_name = item.get("field_name", rule_id)
            existing.description = item.get("description", "")
            existing.required = item.get("required", True)
            existing.expected_format = item.get("expected_format", "")
            existing.min_font_size_mm = item.get("min_font_size_mm", 1.0)
            updated += 1

    stale_ids = set(existing_rules.keys()) - incoming_ids
    for stale_id in stale_ids:
        db.delete(existing_rules[stale_id])

    db.commit()
    logger.info(
        f"Compliance rules synced to database: {inserted} inserted, "
        f"{updated} updated, {len(stale_ids)} removed."
    )


if __name__ == "__main__":
    init_db()
    session = SessionLocal()
    try:
        sync_rules(session)
    except Exception as e:
        logger.error(f"Error syncing rules to DB: {e}")
        session.rollback()
        raise
    finally:
        session.close()
