"""Check stable tailoring labels and saved-field provenance without provider calls."""

from datetime import date

from schemas.gap_analysis_context import CareerContext, LibraryCertification
from tailoring.labeled_sources import label_sources
from tests.fakes import build_gap_analysis_context


def test_complete_library_supplies_all_entry_types() -> None:
    """Writers receive all saved evidence, including education and work highlights."""
    sources = label_sources(build_gap_analysis_context(), [], [])

    assert set(sources.records) == {"SUMMARY", "E1", "H1", "H2", "P1", "ED1", "S1", "S2"}
    assert sources.records["ED1"].text == "BSc, Computer Science, State University"
    assert sources.records["H1"].text == "Senior Engineer at Now Co: Built Python APIs"


def test_saved_evidence_keeps_its_rendered_field_provenance():
    """Every saved source can be screened without searching the library again."""
    context = build_gap_analysis_context()
    context.career_library.career_contexts.append(CareerContext(
        id="fact-1", requirement="Cloud deployments", response="Shipped to AWS"
    ))
    sources = label_sources(context, [], [])
    expected_text = {
        "SUMMARY": "Backend engineer.",
        "E1": "Senior Engineer at Now Co",
        "H1": "Senior Engineer at Now Co: Built Python APIs",
        "H2": "Senior Engineer at Now Co: Tuned Postgres queries",
        "P1": "Deploy bot",
        "ED1": "BSc, Computer Science, State University",
        "S1": "Python",
        "S2": "PostgreSQL",
        "F1": "Cloud deployments: Shipped to AWS",
    }
    expected = {
        "SUMMARY": {"user": {"summary"}},
        "E1": {"experience": {"title", "company", "description"}},
        "H1": {"experience": {"title", "company"}, "experience_highlight": {"content"}},
        "P1": {"project": {"name", "description"}},
        "ED1": {"education": {"degree", "field_of_study", "institution", "description"}},
        "S1": {"skill": {"name"}},
    }
    for label, fields in expected.items():
        assert sources.records[label].text == expected_text[label]
        assert sources.records[label].provenance.used_fields == fields


def test_temporary_evidence_has_no_saved_field_provenance():
    sources = label_sources(
        build_gap_analysis_context(), [{"requirement": "Python", "body": "Used it"}],
        [{"title": "Draft", "content": {"text": "Built tools"}}],
    )
    assert sources.records["GR1"].provenance is None
    assert sources.records["A1"].provenance is None


def test_certification_text_and_provenance_include_the_same_rendered_fields():
    """The fields rendered into certification evidence stay traceable to saved data."""
    context = build_gap_analysis_context()
    context.career_library.certifications.append(LibraryCertification(
        id="certification-1", name="AWS Solutions Architect", issuer="Amazon",
        issued_date=date(2024, 3, 1), expiry_date=date(2027, 3, 1),
        credential_id="AWS-123", credential_url="https://example.com/credential",
    ))
    sources = label_sources(context, [], [])

    source = sources.records["C1"]
    assert source.text == (
        "AWS Solutions Architect, Amazon, issued 2024-03-01, expires 2027-03-01, "
        "AWS-123, https://example.com/credential"
    )
    assert source.provenance.used_fields == {
        "certification": {
            "name", "issuer", "issued_date", "issued_date_precision", "expiry_date", "expiry_date_precision",
            "credential_id", "credential_url", "description"
        }
    }
