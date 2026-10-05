"""
Description: Labeling the library for one tailored section. A section's own rows stay even
when retrieval returned something else.
Index:
    - test_*: one behavior per test
"""

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
