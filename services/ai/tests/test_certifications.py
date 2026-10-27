"""
Description: Certification parsing compatibility, evidence labels, and resume snapshots.
Index:
    - test_old_parse_payload_accepts_missing_certifications
    - test_certification_only_library_supplies_gap_evidence
    - test_certifications_keep_source_labels_and_copy_identity
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
from schemas.tailored_section import ChosenEntry, TailoredSectionDraft
from tailoring.labeled_sources import label_sources
from tailoring.materialize_section import materialize_section


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


def test_certifications_keep_source_labels_and_copy_identity() -> None:
    """Credential labels preserve the identity copied from library rows."""
    context = _context()
    sources = label_sources(context, [], [])
    assert sources.records["C1"].source_type == "Certification"
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="C1")])
    content = materialize_section("certifications", draft, context.career_library, sources)
    assert content == {"items": [{
        "name": "AWS Solutions Architect", "issuer": "Amazon",
        "issued_date": "2024-03-01", "expiry_date": "2027-03-01",
        "credential_id": "AWS-123", "credential_url": "https://example.com/credential",
        "description": None,
    }]}


def test_partial_date_materialization_and_prompt_preserve_precision() -> None:
    """Year/month credential dates never gain a made-up day in snapshots or prompts."""
    from tailoring.build_section_prompt import build_section_prompt

    context = _context()
    certification = context.career_library.certifications[0]
    certification.issued_date_precision = "year"
    certification.expiry_date_precision = "month"
    prompt = build_section_prompt("certifications", context, [], [],
                                  write_anyway=False, gap_analysis=None, today=date(2027, 3, 10))
    assert "Today's date: 2027-03-10" in prompt.text
    assert "unknown within stated expiry period" in prompt.text
    assert "issued 2024" in prompt.text
    assert "expires 2027-03" in prompt.text
    assert "2027-03-01" not in prompt.text
    content = materialize_section("certifications", TailoredSectionDraft(
        nothing_fits=False, entries=[ChosenEntry(label="C1")]), context.career_library, prompt.sources)
    assert content["items"][0]["issued_date"] == "2024"
    assert content["items"][0]["expiry_date"] == "2027-03"
    gap = build_gap_analysis_prompt(context, date(2027, 3, 10))
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
