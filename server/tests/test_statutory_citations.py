import pytest
from fastapi.testclient import TestClient

from main import app
from schemas.ocr import OCRScanResult, TextBlock, BBox, BlockSize, ImageMetadata
from services.rag.citation_service import get_citation_service, LegalCitationService
from services.compliance_evaluator import evaluate_label_compliance
from database import SessionLocal
from models import Inspection, Violation


@pytest.fixture
def client():
    return TestClient(app)


def test_citation_service_loading():
    """Verify LegalCitationService loads all statutory citations from statutory_citations.json."""
    service = get_citation_service()
    assert len(service._citations) >= 20

    # Core Legal Metrology declarations
    mrp_cit = service.get_citation("mrp")
    assert mrp_cit is not None
    assert mrp_cit.act_name == "Legal Metrology (Packaged Commodities) Rules, 2011"
    assert "Rule 6(1)(e)" in mrp_cit.rule_number
    assert "779(E)" in mrp_cit.source_document
    assert len(mrp_cit.statutory_quote) > 10

    usp_cit = service.get_citation("unit_sale_price")
    assert usp_cit is not None
    assert "Rule 6(11)" in usp_cit.rule_number
    assert "779(E)" in usp_cit.source_document

    net_qty_cit = service.get_citation("net_quantity")
    assert net_qty_cit is not None
    assert "Rule 6(1)(b)" in net_qty_cit.rule_number


def test_citation_fuzzy_matching():
    """Verify fuzzy matching resolves variation rule IDs to parent citations."""
    service = get_citation_service()

    # Derived or suffixed IDs
    assert service.get_citation("mrp_missing") is not None
    assert service.get_citation("net_quantity_format") is not None
    assert service.get_citation("viol_consumer_care") is not None


def test_statutory_corpus_search():
    """Verify BM25/keyword statutory search retrieves relevant Gazette excerpts without ML models."""
    service = get_citation_service()
    results = service.search_statutory_corpus("unit sale price", top_k=3)
    assert len(results) > 0
    assert any("779(E)" in r["source_pdf"] or "PCR" in r["source_pdf"] for r in results)


def test_evaluator_attaches_statutory_citations():
    """Verify compliance evaluator automatically attaches citations to found, missing, and wrong items."""
    # Test OCR payload with MRP and Net Qty found, but missing consumer_care and mfg_details
    blocks = [
        TextBlock(
            id=1,
            text="MRP Rs. 150.00 (INCL. OF ALL TAXES)",
            confidence=0.98,
            bbox=BBox(x_min=10, y_min=10, x_max=200, y_max=30),
            size=BlockSize(width=190, height=20, estimated_font_size_px=14.0)
        ),
        TextBlock(
            id=2,
            text="Net Qty: 500 g",
            confidence=0.96,
            bbox=BBox(x_min=10, y_min=40, x_max=150, y_max=60),
            size=BlockSize(width=140, height=20, estimated_font_size_px=12.0)
        )
    ]
    ocr_result = OCRScanResult(
        success=True,
        image_metadata=ImageMetadata(width=600, height=800, channels=3),
        total_text_blocks=len(blocks),
        text_blocks=blocks,
        raw_text="\n".join(b.text for b in blocks),
        processing_time_ms=5.0
    )

    result = evaluate_label_compliance(ocr_result, category="general")

    # Found declarations must have citations
    for decl in result.summary.what_was_found:
        assert decl.citation is not None, f"Found decl '{decl.id}' missing citation"
        assert decl.citation.act_name
        assert decl.citation.rule_number

    # Missing declarations must have citations
    assert len(result.summary.whats_missing) > 0
    for missing in result.summary.whats_missing:
        assert missing.citation is not None, f"Missing decl '{missing.id}' missing citation"
        assert missing.citation.act_name
        assert missing.citation.rule_number

    # Violations must have citations
    assert len(result.summary.whats_wrong) > 0
    for viol in result.summary.whats_wrong:
        assert viol.citation is not None, f"Violation '{viol.rule_id}' missing citation"
        assert viol.citation.act_name

    # Structured result must include serialized citation dictionaries
    assert result.structured_result is not None
    for item in result.structured_result.violation_list:
        assert "citation" in item
        if item.get("citation"):
            assert "act_name" in item["citation"]
            assert "statutory_quote" in item["citation"]


def test_api_citations_endpoints(client):
    """Verify GET /api/v1/compliance/citations and /citations/{rule_id} endpoints."""
    # List all citations
    res = client.get("/api/v1/compliance/citations")
    assert res.status_code == 200
    data = res.json()
    assert "mrp" in data
    assert "unit_sale_price" in data
    assert "net_quantity" in data

    # Get specific rule citation
    res_mrp = client.get("/api/v1/compliance/citations/mrp")
    assert res_mrp.status_code == 200
    mrp_data = res_mrp.json()
    assert mrp_data["act_name"] == "Legal Metrology (Packaged Commodities) Rules, 2011"
    assert "Rule 6(1)(e)" in mrp_data["rule_number"]

    # 404 on nonexistent rule
    res_404 = client.get("/api/v1/compliance/citations/nonexistent_xyz_rule")
    assert res_404.status_code == 404

    # Search statutory corpus
    res_search = client.get("/api/v1/compliance/citations-search?q=unit+sale+price&top_k=2")
    assert res_search.status_code == 200
    search_data = res_search.json()
    assert search_data["total_results"] > 0
    assert len(search_data["results"]) <= 2


def test_violation_model_citation_persistence():
    """Verify that Violation SQLAlchemy model persists citation column in database."""
    db = SessionLocal()
    try:
        inspection = Inspection(
            product_id=None,
            category="general",
            compliance_score=70.0,
            status="NON_COMPLIANT"
        )
        db.add(inspection)
        db.commit()
        db.refresh(inspection)

        citation_data = {
            "act_name": "Legal Metrology (Packaged Commodities) Rules, 2011",
            "rule_number": "Rule 6(1)(e)",
            "section_title": "Maximum Retail Price",
            "source_document": "G.S.R. 779(E)",
            "page_number": 3,
            "statutory_quote": "MRP inclusive of all taxes."
        }

        viol = Violation(
            inspection_id=inspection.id,
            rule_code="mrp",
            severity="CRITICAL",
            title="MRP Missing",
            description="Mandatory declaration 'MRP' is missing.",
            citation=citation_data
        )
        db.add(viol)
        db.commit()
        db.refresh(viol)

        # Query back
        saved_viol = db.query(Violation).filter(Violation.id == viol.id).first()
        assert saved_viol is not None
        assert saved_viol.citation is not None
        assert saved_viol.citation["rule_number"] == "Rule 6(1)(e)"
        assert saved_viol.citation["source_document"] == "G.S.R. 779(E)"
    finally:
        db.close()


def test_rule_12_non_standard_symbol_violation():
    """Verify that using non-standard symbols like '500 gms' flags a Rule 12 violation with citation."""
    blocks = [
        TextBlock(
            id=1,
            text="Net Qty: 500 gms",  # Prohibited under Rule 12 (must be '500 g')
            confidence=0.98,
            bbox=BBox(x_min=10, y_min=10, x_max=200, y_max=30),
            size=BlockSize(width=190, height=20, estimated_font_size_px=14.0)
        )
    ]
    ocr_result = OCRScanResult(
        image_metadata=ImageMetadata(width=600, height=800, channels=3),
        total_text_blocks=1,
        text_blocks=blocks,
        raw_text="Net Qty: 500 gms",
        processing_time_ms=5.0
    )

    eval_result = evaluate_label_compliance(ocr_result, category="general")

    # Should flag a violation for wrong_format citing Rule 12
    symbol_viol = next(
        (v for v in eval_result.summary.whats_wrong if "Rule 12" in v.description or v.rule_id == "net_quantity"),
        None
    )
    assert symbol_viol is not None
    assert symbol_viol.violation_type == "wrong_format"
    assert symbol_viol.citation is not None
    assert "Rule 12" in symbol_viol.citation.rule_number


def test_bee_star_rating_detection():
    """Verify that BEE Star Rating on electronics is recognized with statutory citation."""
    blocks = [
        TextBlock(
            id=1,
            text="ELECTRICITY CONSUMPTION 250 KWH/YEAR BEE STAR RATING",
            confidence=0.97,
            bbox=BBox(x_min=10, y_min=10, x_max=300, y_max=40),
            size=BlockSize(width=290, height=30, estimated_font_size_px=14.0)
        )
    ]
    ocr_result = OCRScanResult(
        image_metadata=ImageMetadata(width=600, height=800, channels=3),
        total_text_blocks=1,
        text_blocks=blocks,
        raw_text="ELECTRICITY CONSUMPTION 250 KWH/YEAR BEE STAR RATING",
        processing_time_ms=5.0
    )

    eval_result = evaluate_label_compliance(ocr_result, category="electronics")

    bee_decl = next((d for d in eval_result.summary.what_was_found if d.id == "bee_star_rating"), None)
    assert bee_decl is not None
    assert bee_decl.citation is not None
    assert "BEE" in bee_decl.citation.act_name or "Energy" in bee_decl.citation.act_name
