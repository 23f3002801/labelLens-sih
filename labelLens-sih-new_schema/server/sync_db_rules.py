"""
Utility CLI Script: sync_db_rules.py
Allows inspection, syncing, and exporting of database compliance rules.
Usage:
    python sync_db_rules.py --list
    python sync_db_rules.py --list --category food
    python sync_db_rules.py --sync-file
    python sync_db_rules.py --export
"""

import sys
import argparse
from database import SessionLocal
from services.rule_loader import get_rules_for_category, sync_rules_to_db, export_db_rules_to_file


def main():
    parser = argparse.ArgumentParser(description="LabelLens Database Compliance Rules Utility")
    parser.add_argument("--list", action="store_true", help="List compliance rules currently active in the database")
    parser.add_argument("--category", type=str, default="all", help="Category to filter by: all, general, food, cosmetics, textile, electronics")
    parser.add_argument("--sync-file", action="store_true", help="Force sync rules from rules.json into the database compliance_rules table")
    parser.add_argument("--export", action="store_true", help="Export active database compliance rules to rules.json file")

    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.sync_file:
            print("Force-syncing rules from rules.json to DB...")
            sync_rules_to_db(db=db, force_update=True)
            print("Successfully synchronized rules.json to DB.")

        if args.export:
            print("Exporting active DB compliance rules to rules.json...")
            success = export_db_rules_to_file(db=db)
            if success:
                print("Exported DB rules to rules.json successfully.")
            else:
                print("Failed to export DB rules.")

        if args.list or (not args.sync_file and not args.export):
            category = args.category or "all"
            rules = get_rules_for_category(category=category, db=db)
            print("\n================ Active DB Compliance Rules ================")
            print(f"Ruleset Version: {rules.get('ruleset_version')}")
            print(f"Country Scope:   {rules.get('country_scope')}")
            print(f"Filter Category: {rules.get('category')}\n")
            print(f"{'ID':<25} {'CATEGORY':<12} {'FIELD NAME':<32} {'TYPE':<8} {'REQ':<6} {'MIN FONT'}")
            print("-" * 95)
            for r in rules.get("mandatory_declarations", []):
                req_str = "Yes" if r.get("required", True) else "No"
                cat_str = r.get("category", "base")
                type_str = r.get("detection_type", "text")
                print(f"{r.get('id'):<25} {cat_str:<12} {r.get('field_name'):<32} {type_str:<8} {req_str:<6} {r.get('min_font_size_mm')}mm")
            print("=" * 95)
            if rules.get("exemptions"):
                print("\nApplicable Category Exemptions:")
                for ex in rules["exemptions"]:
                    print(f" - [{ex.get('condition')}]: {ex.get('description')} (Exempts: {', '.join(ex.get('exempted_rule_ids', []))})")
                print("=" * 95)

    finally:
        db.close()


if __name__ == "__main__":
    main()
