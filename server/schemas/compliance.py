from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from schemas.ocr import BBox, OCRScanResult

class LegalCitation(BaseModel):
    act_name: str = Field(..., description="Name of the governing Act or Regulation")
    rule_number: Optional[str] = Field(default=None, description="Specific Rule, Section, or Clause (e.g. 'Rule 6(1)(e)')")
    section_title: Optional[str] = Field(default=None, description="Title of the section or statutory requirement")
    source_document: str = Field(..., description="Source document or Gazette notification (e.g. G.S.R. 779(E))")
    page_number: Optional[int] = Field(default=None, description="Page number in the source document")
    statutory_quote: str = Field(..., description="Verbatim statutory requirement text")

class DeclarationFound(BaseModel):
    id: str = Field(..., description="Rule ID (e.g., mrp, net_quantity)")
    field_name: str = Field(..., description="Human readable declaration name")
    extracted_text: str = Field(..., description="Exact raw text block extracted")
    parsed_value: Optional[str] = Field(default=None, description="Clean parsed value (e.g. 250.00, 440g)")
    confidence: float = Field(..., description="OCR detection confidence score")
    bbox: BBox = Field(..., description="Bounding box location on label photo")
    font_size_px: float = Field(..., description="Font height in pixels")
    font_size_mm_est: float = Field(..., description="Estimated physical font height in mm")
    format_valid: bool = Field(default=True, description="True if text matches mandated Legal Metrology format")
    size_valid: bool = Field(default=True, description="True if font size meets minimum height requirement")
    status: str = Field(default="COMPLIANT", description="COMPLIANT, FORMAT_ERROR, or TOO_SMALL")
    citation: Optional[LegalCitation] = Field(default=None, description="Official statutory Act/Rule citation")

class DeclarationMissing(BaseModel):
    id: str = Field(..., description="Rule ID of missing declaration")
    field_name: str = Field(..., description="Human readable name of missing declaration")
    description: str = Field(..., description="Legal requirement description")
    required: bool = Field(..., description="Whether this declaration is mandatory")
    citation: Optional[LegalCitation] = Field(default=None, description="Official statutory Act/Rule citation")

class ViolationDetail(BaseModel):
    id: str = Field(..., description="Unique violation ID")
    rule_id: str = Field(..., description="Declaration rule ID (e.g. mrp, net_quantity)")
    field_name: str = Field(..., description="Declaration name")
    violation_type: str = Field(..., description="'missing', 'wrong_format', or 'too_small'")
    severity: str = Field(..., description="'CRITICAL', 'MAJOR', or 'MINOR'")
    description: str = Field(..., description="Detailed explanation of legal non-compliance")
    detected_on_package: Optional[str] = Field(default=None, description="Exact text or status found on packaging that caused violation")
    expected_on_package: Optional[str] = Field(default=None, description="Legally mandated format or declaration that package must display")
    package_element: Optional[str] = Field(default=None, description="Section or component of the package in violation (e.g. Principal Display Panel, Net Quantity Declaration)")
    evidence_bbox: Optional[BBox] = Field(default=None, description="Location of non-compliant block")
    citation: Optional[LegalCitation] = Field(default=None, description="Official statutory Act/Rule citation for this violation")

class ComplianceSummary(BaseModel):
    what_was_found: List[DeclarationFound] = Field(..., description="List of all detected legal declarations")
    whats_missing: List[DeclarationMissing] = Field(..., description="List of missing mandatory declarations")
    whats_wrong: List[ViolationDetail] = Field(..., description="List of all non-compliance violations found")


class StructuredComplianceResult(BaseModel):
    compliance_score: float = Field(..., description="Compliance score percentage from 0.0 to 100.0")
    extracted_declarations: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="List of extracted declaration entries with normalized field name, value, and status",
    )
    violation_list: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="List of violations with rule_id, severity, description, and evidence",
    )
    final_status: str = Field(..., description="COMPLIANT, NON_COMPLIANT, or FAILED")


class ComplianceResult(BaseModel):
    overall_result: str = Field(..., description="'PASS' or 'FAIL'")
    compliance_score: float = Field(..., description="Compliance score percentage (0.0 to 100.0)")
    total_declarations_required: int = Field(..., description="Total count of mandatory legal declarations")
    total_found: int = Field(..., description="Count of valid declarations found")
    summary: ComplianceSummary = Field(..., description="Detailed breakdown: what was found, missing, and wrong")
    processing_time_ms: float = Field(..., description="Total processing time in milliseconds")
    annotated_image_base64: Optional[str] = Field(default=None, description="Optional base64 annotated evidence image")
    structured_result: Optional[StructuredComplianceResult] = Field(
        default=None,
        description="Normalized structured output for downstream API/UI consumption",
    )
