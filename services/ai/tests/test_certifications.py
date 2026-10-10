"""
Description: Certification parsing compatibility, evidence labels, and resume snapshots.
Index:
    - test_old_parse_payload_accepts_missing_certifications
    - test_certification_only_library_supplies_gap_evidence
    - test_native_certifications_survive_retrieval_and_copy_identity
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


def test_native_certifications_survive_retrieval_and_copy_identity() -> None:
    """Unrelated search results cannot hide credentials; identity comes from library rows."""
    context = _context()
    sources = label_sources(context, [], [], {("Experience", "unrelated")}, "certifications")
    assert sources.records["C1"].source_type == "Certification"
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="C1")])
    content = materialize_section("certifications", draft, context.career_library, sources)
    assert content == {"items": [{
        "name": "AWS Solutions Architect", "issuer": "Amazon",
        "issued_date": "2024-03", "expiry_date": "2027-03",
        "credential_id": "AWS-123", "credential_url": "https://example.com/credential",
        "description": None,
    }]}
