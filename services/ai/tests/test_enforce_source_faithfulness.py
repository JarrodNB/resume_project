"""
Description: Tests for the faithfulness guard that checks a ParsedResume against its source text.
Index:
    - SOURCE_TEXT: a small resume as text extraction might return it
    - build_parsed_resume: a parse of SOURCE_TEXT with overridable highlights and skills
    - test_*: one behavior per test
"""

from documents.enforce_source_faithfulness import enforce_source_faithfulness
from schemas.parsed_resume import (
    ParsedEducation,
    ParsedExperience,
    ParsedProject,
    ParsedResume,
    ParsedSkill,
)

SOURCE_TEXT = """\
Jane Doe
Software Engineer, Acme Corp
• Built a billing service handling
  2M requests a day
Projects: Tidepool
Education: State University
Skills: Python, PostgreSQL
"""


def build_parsed_resume(
    highlights: list[str] | None = None,
    skills: list[str] | None = None,
    company: str = "Acme Corp",
) -> ParsedResume:
    """Builds a faithful parse of SOURCE_TEXT, with the given parts swapped in."""
    return ParsedResume(
        experiences=[
            ParsedExperience(
                company=company,
                title="Software Engineer",
                highlights=highlights
                if highlights is not None
                else ["Built a billing service handling 2M requests a day"],
            )
        ],
        projects=[ParsedProject(name="Tidepool")],
        educations=[ParsedEducation(institution="State University")],
        skills=[ParsedSkill(name=name) for name in (skills or ["Python", "PostgreSQL"])],
    )


def test_faithful_parse_is_returned_unchanged() -> None:
    """A parse where everything appears in the source comes back as is, with no warnings."""
    parsed_resume = build_parsed_resume()

    assert enforce_source_faithfulness(parsed_resume, SOURCE_TEXT) == parsed_resume


def test_verbatim_highlight_is_kept_despite_case_bullets_and_line_breaks() -> None:
    """Matching ignores case, bullets, and the line break inserted by text extraction."""
    highlight = "• BUILT a billing service handling 2M requests a day"

    result = enforce_source_faithfulness(build_parsed_resume(highlights=[highlight]), SOURCE_TEXT)

    assert result.experiences[0].highlights == [highlight]
    assert result.parsing_warnings == []


def test_rephrased_highlight_is_removed_with_a_warning() -> None:
    """A highlight the model rewrote is dropped, and the warning quotes it."""
    rephrased = "Engineered a high-throughput billing platform"
    kept = "Built a billing service handling 2M requests a day"

    result = enforce_source_faithfulness(
        build_parsed_resume(highlights=[kept, rephrased]), SOURCE_TEXT
    )

    assert result.experiences[0].highlights == [kept]
    [warning] = result.parsing_warnings
    assert "Acme Corp" in warning
    assert rephrased in warning


def test_invented_skill_is_removed_with_a_warning() -> None:
    """A skill that isn't in the resume is dropped."""
    result = enforce_source_faithfulness(
        build_parsed_resume(skills=["Python", "Kubernetes"]), SOURCE_TEXT
    )

    assert [skill.name for skill in result.skills] == ["Python"]
    [warning] = result.parsing_warnings
    assert "Kubernetes" in warning


def test_unmatched_company_is_kept_with_a_warning() -> None:
    """Entries are never dropped over a name mismatch; the user is asked to check instead."""
    result = enforce_source_faithfulness(build_parsed_resume(company="Acme Inc."), SOURCE_TEXT)

    assert result.experiences[0].company == "Acme Inc."
    assert result.experiences[0].highlights
    [warning] = result.parsing_warnings
    assert "company" in warning
    assert "Acme Inc." in warning


def test_existing_warnings_are_preserved() -> None:
    """Warnings from the agent stay ahead of the guard's own warnings."""
    parsed_resume = build_parsed_resume(skills=["Kubernetes"]).model_copy(
        update={"parsing_warnings": ["Unsure whether Tidepool is a job."]}
    )

    result = enforce_source_faithfulness(parsed_resume, SOURCE_TEXT)

    assert result.parsing_warnings[0] == "Unsure whether Tidepool is a job."
    assert len(result.parsing_warnings) == 2
