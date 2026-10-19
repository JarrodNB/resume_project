"""Check stable tailoring labels and saved-field provenance without provider calls."""

from tailoring.labeled_sources import label_sources
from tests.fakes import build_gap_analysis_context


def test_education_stays_when_retrieval_only_found_a_highlight() -> None:
    """A degree is labeled for the education section even if search returned a work highlight."""
    context = build_gap_analysis_context()
    retrieved = {("ExperienceHighlight", "highlight-1")}

    sources = label_sources(context, [], [], retrieved, "education")

    assert "ED1" in sources.records
    assert sources.records["ED1"].text == "BSc, Computer Science, State University"


def test_an_unrelated_highlight_is_left_out_of_education() -> None:
    """Education does not list work highlights when retrieval found none of them."""
    sources = label_sources(build_gap_analysis_context(), [], [], set(), "education")

    assert "ED1" in sources.records
    assert "H1" not in sources.records


def test_saved_evidence_keeps_its_rendered_field_provenance():
    """Every saved source can be screened without searching the library again."""
    sources = label_sources(build_gap_analysis_context(), [], [], None)
    expected = {
        "SUMMARY": {"user": {"summary"}},
        "E1": {"experience": {"title", "company", "description"}},
        "H1": {"experience": {"title", "company"}, "experience_highlight": {"content"}},
        "P1": {"project": {"name", "description"}},
        "ED1": {"education": {"degree", "field_of_study", "institution"}},
        "S1": {"skill": {"name"}},
    }
    for label, fields in expected.items():
        assert sources.records[label].provenance.used_fields == fields


def test_temporary_evidence_has_no_saved_field_provenance():
    sources = label_sources(
        build_gap_analysis_context(), [{"requirement": "Python", "body": "Used it"}],
        [{"title": "Draft", "content": {"text": "Built tools"}}], None,
    )
    assert sources.records["GR1"].provenance is None
    assert sources.records["A1"].provenance is None
