"""
Description: The tailoring checker rejects unsupported names and numbers and does not rewrite
the section itself.
Index:
    - test_*: one behavior per test
"""

from schemas.tailored_section import ChosenEntry, CitedProse, TailoredSectionDraft
from tailoring.build_section_prompt import build_section_prompt
from tailoring.check_section_faithfulness import find_section_problems
from tailoring.labeled_sources import LabeledSources, SourceRecord
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


def test_sentence_opening_acronym_is_not_a_proper_name() -> None:
    """'Integrated AI' opens a sentence. AI is checked on its own, and it is in the source."""
    sources = LabeledSources(
        records={
            "E1": SourceRecord("E1", "experience", "Engineer at Co"),
            "H1": SourceRecord("H1", "highlight", "Built an AI assistant"),
        }
    )
    draft = TailoredSectionDraft(
        nothing_fits=False,
        entries=[
            ChosenEntry(
                label="E1",
                prose=[CitedProse(text="Integrated AI into the product.", source_labels=["H1"])],
            )
        ],
    )

    assert find_section_problems("experience", draft, sources) == []


def test_invented_name_is_rejected() -> None:
    """A two-word name the cited source never states is a problem."""
    sources = LabeledSources(
        records={
            "E1": SourceRecord("E1", "experience", "Engineer at Co"),
            "H1": SourceRecord("H1", "highlight", "Moved hosting in-house"),
        }
    )
    draft = TailoredSectionDraft(
        nothing_fits=False,
        entries=[
            ChosenEntry(
                label="E1",
                prose=[CitedProse(text="Moved hosting to Google Cloud.", source_labels=["H1"])],
            )
        ],
    )

    problems = find_section_problems("experience", draft, sources)

    assert problems
    assert "Google Cloud" in problems[0]


def test_nothing_fits_must_be_empty() -> None:
    """Saying nothing fits while still returning a role is a problem."""
    draft = TailoredSectionDraft(
        nothing_fits=True, entries=[ChosenEntry(label="E1", prose=[])]
    )

    assert find_section_problems("experience", draft, _sources())
