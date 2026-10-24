"""
Description: Tests for the gap analysis prompt: labels, label maps, and date formatting.
Index:
    - test_*: one behavior per test
"""

from datetime import date

from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt, format_date_range
from schemas.gap_analysis_context import LibraryFact
from tests.fakes import build_gap_analysis_context

TODAY = date(2026, 10, 4)


def test_labels_requirements_in_posting_order() -> None:
    """Requirements are R1, R2, ... and nice-to-haves N1, ..., with their text in the prompt."""
    prompt = build_gap_analysis_prompt(build_gap_analysis_context(), TODAY)

    assert {ref: requirement.text for ref, requirement in prompt.requirements.items()} == {
        "R1": "5+ years of Python",
        "R2": "PostgreSQL",
        "N1": "Kubernetes",
    }
    assert prompt.requirements["N1"].kind == "nice_to_have"
    assert "[R1] 5+ years of Python" in prompt.text
    assert "[N1] Kubernetes" in prompt.text


def test_labels_every_library_entry_with_its_id_and_text() -> None:
    """Each library entry gets a label that maps back to its database id and text."""
    prompt = build_gap_analysis_prompt(build_gap_analysis_context(), TODAY)

    assert list(prompt.evidence) == ["E1", "H1", "H2", "P1", "ED1", "S1", "S2"]
    highlight = prompt.evidence["H2"]
    assert (highlight.kind, highlight.id, highlight.text) == (
        "highlight",
        "highlight-2",
        "Tuned Postgres queries",
    )
    assert highlight.context == "Senior Engineer at Now Co"
    assert prompt.evidence["ED1"].text == "BSc, Computer Science, State University"
    assert prompt.evidence["S1"].context == "Languages"
    assert "Backend engineer." in prompt.text
    assert "[SUMMARY]" not in prompt.text
    assert "SUMMARY" not in prompt.evidence


def test_prompt_shows_today_and_role_dates() -> None:
    """The model gets today's date and each role's dates, so it can count years."""
    prompt = build_gap_analysis_prompt(build_gap_analysis_context(), TODAY)

    assert "Today's date: 2026-10-04" in prompt.text
    assert "[E1] Senior Engineer at Now Co | Jan 2018 – present" in prompt.text
    assert "  [H1] Built Python APIs" in prompt.text


def test_leaves_out_empty_sections() -> None:
    """No summary means no profile-summary section; no nice-to-haves means no N labels."""
    context = build_gap_analysis_context(nice_to_haves=[])
    context.career_library.summary = None

    prompt = build_gap_analysis_prompt(context, TODAY)

    assert "Profile summary" not in prompt.text
    assert "SUMMARY" not in prompt.evidence
    assert "Nice to have" not in prompt.text
    assert "Responsibilities" not in prompt.text
    assert list(prompt.requirements) == ["R1", "R2"]


def test_excludes_responsibilities_from_qualification_prompt() -> None:
    """Saved duties do not become qualifications or enter the comparison prompt."""
    context = build_gap_analysis_context(responsibilities=["Ship models to production"])

    prompt = build_gap_analysis_prompt(context, TODAY)

    assert list(prompt.requirements) == ["R1", "R2", "N1"]
    assert "Ship models to production" not in prompt.text
    assert "Responsibilities" not in prompt.text


def test_labels_library_facts() -> None:
    """A fact the user added to the library is F1, with the answer as its text."""
    context = build_gap_analysis_context()
    context.career_library.facts = [
        LibraryFact(
            id="fact-1", requirement="Kubernetes", response="Ran it at Northwind for two years"
        )
    ]

    prompt = build_gap_analysis_prompt(context, TODAY)

    fact = prompt.evidence["F1"]
    assert (fact.kind, fact.id, fact.text, fact.context) == (
        "fact",
        "fact-1",
        "Ran it at Northwind for two years",
        "Kubernetes",
    )
    assert "[F1] Kubernetes: Ran it at Northwind for two years" in prompt.text
    assert prompt.warnings == []


def test_format_date_range() -> None:
    """Ongoing, finished, undated, and end-only ranges."""
    assert format_date_range(date(2020, 3, 1), None) == "Mar 2020 – present"
    assert format_date_range(date(2015, 1, 1), date(2018, 6, 1)) == "Jan 2015 – Jun 2018"
    assert format_date_range(None, None) is None
    assert format_date_range(None, date(2018, 6, 1)) == "? – Jun 2018"


def test_job_screening_uses_the_prompt_job_projection() -> None:
    """Only fields available to gap generation are sent for required job screening."""
    from gap_analysis.build_gap_analysis_prompt import gap_job_input, gap_job_screening_text

    context = build_gap_analysis_context(responsibilities=["Ship models to production"])
    job = gap_job_input(context.job)
    screened = gap_job_screening_text(job)
    prompt = build_gap_analysis_prompt(context, TODAY)

    for value in (job.title, job.company, *job.requirements, *job.nice_to_haves):
        assert value in screened and value in prompt.text
    assert "Ship models to production" not in screened
    assert "Ship models to production" not in prompt.text
