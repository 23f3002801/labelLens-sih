"""Re-runs the compliance evaluator over every stored scan, in place.

Scans persist their full OCR output (`raw_ocr_output`), so a change to the evaluator or
to rules.json can be applied to historical scans without re-uploading anything and
without paying for OCR again - re-evaluation is single-digit milliseconds per scan.

Run it after changing the evaluator or the ruleset, so replayed demo scans show what the
current code would say rather than what an older build happened to say:

    uv run python scripts/refresh_compliance.py            # apply
    uv run python scripts/refresh_compliance.py --dry-run  # report only
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import Inspection, Violation
from schemas.ocr import OCRScanResult
from services.compliance_evaluator import evaluate_label_compliance
from services.rule_loader import get_rules_from_db


def _stored_ocr(inspection: Inspection) -> OCRScanResult | None:
    raw = inspection.raw_ocr_output
    if not isinstance(raw, dict) or "text_blocks" not in raw:
        return None
    payload = {k: v for k, v in raw.items() if k != "structured_compliance"}
    try:
        return OCRScanResult(**payload)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report changes without writing")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        ruleset = get_rules_from_db(db=db)
        inspections = db.query(Inspection).all()

        refreshed = skipped = changed = 0

        for inspection in inspections:
            ocr_result = _stored_ocr(inspection)
            if ocr_result is None:
                skipped += 1
                continue

            result = evaluate_label_compliance(ocr_result, ruleset=ruleset, db=db)

            before = len(inspection.extracted_declarations or []), inspection.compliance_score
            declarations = [d.model_dump() for d in result.summary.what_was_found]
            new_status = "COMPLIANT" if result.overall_result == "PASS" else "NON_COMPLIANT"
            after = len(declarations), result.compliance_score

            if before != after or inspection.status != new_status:
                changed += 1
                print(
                    f"  {inspection.id[:8]}  declarations {before[0]:>2} -> {after[0]:<2}  "
                    f"score {before[1] or 0:>5.1f} -> {after[1]:<5.1f}  {inspection.status} -> {new_status}"
                )

            refreshed += 1
            if args.dry_run:
                continue

            inspection.extracted_declarations = declarations
            inspection.compliance_score = result.compliance_score
            inspection.status = new_status
            # structured_result is a dict on some paths and a pydantic model on others
            # (same normalization routers/uploads.py::_process_scan does before storing).
            structured = result.structured_result
            if hasattr(structured, "model_dump"):
                structured = structured.model_dump()
            inspection.raw_ocr_output = {
                **(inspection.raw_ocr_output or {}),
                "structured_compliance": structured,
            }

            # Violations are rows, not a JSON column: clear the previous verdict's rows
            # before writing the new ones, or every run would stack duplicates.
            for violation in list(inspection.violations):
                db.delete(violation)
            db.flush()

            for violation in result.summary.whats_wrong:
                db.add(
                    Violation(
                        inspection_id=inspection.id,
                        rule_code=violation.rule_id,
                        severity=violation.severity,
                        title=f"{violation.field_name} - {violation.violation_type.upper()}",
                        description=violation.description,
                        evidence_bbox=(
                            violation.evidence_bbox.model_dump()
                            if violation.evidence_bbox
                            else None
                        ),
                    )
                )

        if args.dry_run:
            db.rollback()
        else:
            db.commit()

        verb = "would refresh" if args.dry_run else "refreshed"
        print(f"\n{verb} {refreshed} scan(s), {changed} changed, skipped {skipped} without usable OCR")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
