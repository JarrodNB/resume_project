"""
Description: The tailoring checker rejects unsupported names and numbers and does not rewrite
the section itself.
Index:
    - test_*: one behavior per test
"""

from schemas.tailored_section import ChosenEntry, CitedProse, TailoredSectionDraft
from tailoring.build_section_prompt import build_section_prompt
from tailoring.check_section_faithfulness import find_section_problems
from tests.fakes import build_gap_analysis_context


def _sources():
    """The whole fake library, labeled."""
    prompt = build_section_prompt(
        "experience",
        build_gap_analysis_context(),
        [],
        [],
        None,
        write_anyway=False,
        gap_analysis=None,
    )
    return prompt.sources


def test_supported_bullet_passes() -> None:
    """A bullet that only restates a cited highlight is kept as the model wrote it."""
    draft = TailoredSectionDraft(
        nothing_fits=False,
        entries=[
            ChosenEntry(
                label="E1",
                prose=[CitedProse(text="Built Python APIs.", source_labels=["H1"])],
            )
        ],
    )

    assert find_section_problems("experience", draft, _sources()) == []


def test_invented_metric_is_rejected() -> None:
    """A number none of the cited sources state is a problem, and the prose is unchanged."""
    prose = CitedProse(text="Cut latency 99% at Initech.", source_labels=["H1"])
    draft = TailoredSectionDraft(
        nothing_fits=False, entries=[ChosenEntry(label="E1", prose=[prose])]
    )

    problems = find_section_problems("experience", draft, _sources())

    assert problems
    assert "99%" in problems[0]
    assert prose.text == "Cut latency 99% at Initech."


def test_nothing_fits_must_be_empty() -> None:
    """Saying nothing fits while still returning a role is a problem."""
    draft = TailoredSectionDraft(
        nothing_fits=True, entries=[ChosenEntry(label="E1", prose=[])]
    )

    assert find_section_problems("experience", draft, _sources())
