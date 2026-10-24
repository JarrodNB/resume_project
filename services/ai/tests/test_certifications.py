"""
Description: Certification parsing compatibility, comparison evidence, and precise dates.
Index:
    - test_old_parse_payload_accepts_missing_certifications
    - test_certification_only_library_supplies_gap_evidence
"""
from datetime import date

from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from schemas.gap_analysis_context import (
    CareerLibrary,
    GapAnalysisContext,
    JobToAnalyze,
    LibraryCertification,
)
from schemas.parsed_resume import ParsedResume


def _context() -> GapAnalysisContext:
    """A library with a single credential and a job requiring that credential."""
    return GapAnalysisContext(
        job=JobToAnalyze(id="job", title="Cloud Engineer", company="Northwind", requirements=["AWS certification"]),
        career_library=CareerLibrary(certifications=[LibraryCertification(
            id="cert", name="AWS Solutions Architect", issuer="Amazon",
            issued_date=date(2024, 3, 1), expiry_date=date(2027, 3, 1),
            credential_id="AWS-123", credential_url="https://example.com/credential",
        )]),
    )


def test_old_parse_payload_accepts_missing_certifications() -> None:
    """Results already on the queue do not need a certification list."""
    assert ParsedResume.model_validate({"educations": []}).certifications == []


def test_certification_only_library_supplies_gap_evidence() -> None:
    """A credential is citable independently of a degree and retains validity dates."""
    context = _context()
    assert not context.career_library.is_empty()
    prompt = build_gap_analysis_prompt(context, date(2026, 10, 10))
    assert prompt.evidence["C1"].kind == "certification"
    assert prompt.evidence["C1"].id == "cert"
    assert "expires 2027-03-01" in prompt.evidence["C1"].text
    assert "## Certifications" in prompt.text
    assert "## Education" not in prompt.text


def test_partial_date_gap_prompt_preserves_precision() -> None:
    """Year/month credential dates never gain a made-up day in comparison prompts."""
    context = _context()
    certification = context.career_library.certifications[0]
    certification.issued_date_precision = "year"
    certification.expiry_date_precision = "month"
    gap = build_gap_analysis_prompt(context, date(2027, 3, 10))
    assert "issued 2024" in gap.text
    assert "expires 2027-03" in gap.text
    assert "2027-03-01" not in gap.text


def test_expiry_boundaries_include_unknown_partial_period() -> None:
    """Exact days expire the next day; year/month precision is unknown within the period."""
    from schemas.certification_dates import certification_expiry_status

    cases = [
        (date(2027, 1, 1), "year", date(2026, 12, 31), "not yet expired"),
        (date(2027, 1, 1), "year", date(2027, 1, 1), "unknown within stated expiry period"),
        (date(2027, 1, 1), "year", date(2027, 12, 31), "unknown within stated expiry period"),
        (date(2027, 1, 1), "year", date(2028, 1, 1), "expired"),
        (date(2028, 2, 1), "month", date(2028, 1, 31), "not yet expired"),
        (date(2028, 2, 1), "month", date(2028, 2, 29), "unknown within stated expiry period"),
        (date(2028, 2, 1), "month", date(2028, 3, 1), "expired"),
        (date(2027, 3, 10), "day", date(2027, 3, 10), "not yet expired"),
        (date(2027, 3, 10), "day", date(2027, 3, 11), "expired"),
    ]
    for expiry, precision, today, status in cases:
        assert certification_expiry_status(expiry, precision, today) == status
