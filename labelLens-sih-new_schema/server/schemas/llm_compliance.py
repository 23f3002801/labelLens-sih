from typing import List, Optional
from pydantic import BaseModel, Field


class LLMRuleEvaluation(BaseModel):
    rule_id: str = Field(..., description="ID of the evaluated Legal Metrology / category rule")
    status: str = Field(..., description="Evaluation outcome: PASS, FAIL, or EXEMPT")
    extracted_value: Optional[str] = Field(default=None, description="Clean extracted value (e.g. ₹250.00, 100g)")
    exact_quote: Optional[str] = Field(default=None, description="Exact verbatim substring found in OCR text for grounding")
    detected_on_package: Optional[str] = Field(default=None, description="Exact text or status found on packaging that caused violation")
    expected_on_package: Optional[str] = Field(default=None, description="Legally mandated format or declaration that package must display")
    package_element: Optional[str] = Field(default=None, description="Section or component of the package in violation (e.g. Principal Display Panel, Net Quantity Declaration)")
    violation_type: Optional[str] = Field(
        default=None,
        description="Violation category: missing, wrong_format, too_small, or other"
    )
    severity: Optional[str] = Field(
        default=None,
        description="Violation severity: CRITICAL, MAJOR, or MINOR"
    )
    explanation: str = Field(..., description="Detailed rationale explaining the legal determination")
    grounded: bool = Field(default=True, description="True if exact_quote was verified in raw OCR text")


class LLMComplianceResponse(BaseModel):
    category: str = Field(default="general", description="Product category evaluated")
    overall_result: str = Field(..., description="PASS or FAIL")
    compliance_score: float = Field(..., description="Compliance percentage 0.0 to 100.0")
    summary: str = Field(..., description="Executive summary of the compliance inspection")
    evaluations: List[LLMRuleEvaluation] = Field(default_factory=list, description="Per-rule evaluation results")
