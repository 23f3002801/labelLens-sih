"""Replay (demo) mode support.

Every scan the pipeline has ever finished is already persisted in full - the OCR output,
the extracted declarations, the violations and the Cloudinary URL of the image itself. A
demo therefore does not need to re-run anything: it can hand the app a scan that was
genuinely produced by the pipeline earlier and render it instantly.

That matters because the expensive stage is not OCR (~1.5s) or the compliance evaluator
(~5ms) but the SAM 2 unwrap of a 360 video, which is minutes of CPU work and needs a
900MB checkpoint that is not committed to the repo.

Scans are not stored with a "which capture did this come from" key, so a 360 capture's
faces are recovered here by clustering finished scans on their created_at timestamps:
frames of one video are written seconds apart, while separate captures sit minutes or
hours apart. See GROUP_GAP_SECONDS.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from models import Inspection

# Frames of a single 360 capture are committed ~4-15s apart (one OCR + compliance pass
# each); the next capture is minutes away at best. 60s splits every batch in the current
# database cleanly with a wide margin on both sides.
GROUP_GAP_SECONDS = 60.0

FINISHED_STATUSES = ("COMPLIANT", "NON_COMPLIANT")


def serialize_inspection(inspection: Inspection) -> Dict[str, Any]:
    """The scan shape every result endpoint returns, and the only shape the mobile
    app's buildDeclarations() knows how to read."""
    return {
        "scan_id": inspection.id,
        "status": inspection.status,
        "image_path": inspection.image_path,
        "created_at": inspection.created_at,
        "compliance_score": inspection.compliance_score,
        "ocr_result": inspection.raw_ocr_output,
        "extracted_declarations": inspection.extracted_declarations,
        "violations": [
            {
                "id": violation.id,
                "rule_code": violation.rule_code,
                "severity": violation.severity,
                "title": violation.title,
                "description": violation.description,
                "evidence_bbox": violation.evidence_bbox,
            }
            for violation in inspection.violations
        ],
    }


def _capture_kind(inspection: Inspection) -> str:
    """Photos upload under public_id 'scan_{id}', video faces under 'video_scan_{id}'
    (see routers/uploads.py and routers/video.py). Order matters - 'video_scan_' also
    contains 'scan_'."""
    path = inspection.image_path or ""
    if "video_scan_" in path:
        return "video"
    if "scan_" in path:
        return "photo"
    return "unknown"


def _text_block_count(inspection: Inspection) -> int:
    raw = inspection.raw_ocr_output or {}
    if not isinstance(raw, dict):
        return 0
    blocks = raw.get("text_blocks")
    if isinstance(blocks, list):
        return len(blocks)
    return int(raw.get("total_text_blocks") or 0)


def _is_usable(inspection: Inspection) -> bool:
    """Drops rows that can't render as a demo: no image to show, or OCR that read
    nothing at all (early test rows and frames that were pure background)."""
    if not inspection.image_path:
        return False
    if inspection.status not in FINISHED_STATUSES:
        return False
    return _text_block_count(inspection) > 0


def _group_scans(inspections: List[Inspection]) -> List[List[Inspection]]:
    """Clusters chronologically ordered scans into capture batches. A new batch starts
    whenever the gap to the previous scan exceeds GROUP_GAP_SECONDS, or the capture kind
    changes (a photo taken right after a video is its own scan, not a fifth face)."""
    groups: List[List[Inspection]] = []

    for inspection in inspections:
        if groups:
            previous = groups[-1][-1]
            gap = (inspection.created_at - previous.created_at).total_seconds()
            same_batch = (
                gap <= GROUP_GAP_SECONDS
                and _capture_kind(inspection) == _capture_kind(previous)
            )
            if same_batch:
                groups[-1].append(inspection)
                continue
        groups.append([inspection])

    return groups


def _declaration_count(inspection: Inspection) -> int:
    return len(inspection.extracted_declarations or [])


def _summarize(group: List[Inspection]) -> Dict[str, Any]:
    lead = group[0]
    kind = _capture_kind(lead)
    declarations = sum(_declaration_count(i) for i in group)
    violations = sum(len(i.violations) for i in group)
    # A capture passes only if every one of its faces passed - the same rule the mobile
    # app applies when it merges faces into one product-level verdict.
    status = "COMPLIANT" if all(i.status == "COMPLIANT" for i in group) else "NON_COMPLIANT"
    scores = [i.compliance_score for i in group if i.compliance_score is not None]

    return {
        # The lead frame's scan id doubles as the group id: stable, already unique, and
        # directly resolvable back to the batch by re-running this grouping.
        "demo_id": lead.id,
        "kind": kind,
        "title": ("360° capture" if kind == "video" else "Photo scan"),
        "frame_count": len(group),
        "thumbnail_url": lead.image_path,
        "status": status,
        "compliance_score": round(sum(scores) / len(scores), 1) if scores else 0.0,
        "declaration_count": declarations,
        "violation_count": violations,
        "created_at": lead.created_at,
    }


def _quality(group: List[Inspection]) -> tuple:
    """Best demos first: the ones that actually extracted declarations, then the ones
    that read the most text, then the most recent."""
    return (
        sum(_declaration_count(i) for i in group),
        sum(_text_block_count(i) for i in group),
        group[0].created_at.timestamp() if group[0].created_at else 0.0,
    )


def load_groups(db: Session) -> List[List[Inspection]]:
    inspections = (
        db.query(Inspection)
        .filter(Inspection.status.in_(FINISHED_STATUSES))
        .order_by(Inspection.created_at.asc())
        .all()
    )
    usable = [i for i in inspections if _is_usable(i)]
    return _group_scans(usable)


def list_demo_scans(db: Session, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    groups = sorted(load_groups(db), key=_quality, reverse=True)
    summaries = [_summarize(group) for group in groups]
    return summaries[:limit] if limit else summaries


def get_demo_scan(db: Session, demo_id: str) -> Optional[Dict[str, Any]]:
    for group in load_groups(db):
        if group[0].id == demo_id:
            return {
                **_summarize(group),
                "frames": [serialize_inspection(i) for i in group],
            }
    return None
