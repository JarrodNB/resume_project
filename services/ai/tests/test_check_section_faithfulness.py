"""Check that tailoring keeps supported wording and rejects invented claims.

Synthetic labeled evidence exercises the public validator without calling providers.
The checker reports useful retry reasons and never rewrites the draft itself.
"""

import pytest

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


def test_sentence_boundary_does_not_create_a_false_product_name() -> None:
    sources = LabeledSources(records={"SUMMARY": SourceRecord(
        "SUMMARY", "summary", "Built on AWS and Kubernetes with production AI experience.")})
    draft = TailoredSectionDraft(nothing_fits=False, entries=[], summary=CitedProse(
        text="Built on AWS and Kubernetes. Brings production AI experience.", source_labels=["SUMMARY"]))

    assert find_section_problems("summary", draft, sources) == []


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


@pytest.mark.parametrize(
    ("text", "source"),
    [
        ("Implemented Qdrant for semantic search.", "Used Qdrant for semantic search."),
        ("Built GraphQL APIs for customers.", "Developed GraphQL APIs for customers."),
        ("Integrated AI into the product. Implemented Qdrant search.", "AI and Qdrant search"),
    ],
)
def test_supported_opening_action_preserves_technology_wording(text: str, source: str) -> None:
    """Changing the action verb does not turn a supported technology into an invented name."""
    sources = LabeledSources(records={
        "E1": SourceRecord("E1", "experience", "Engineer at Co"),
        "H1": SourceRecord("H1", "highlight", source),
    })
    prose = CitedProse(text=text, source_labels=["H1"])
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="E1", prose=[prose])])

    assert find_section_problems("experience", draft, sources) == []
    assert prose.text == text


@pytest.mark.parametrize(
    ("text", "unsupported"),
    [
        ("Implemented Qdrant for search.", "Qdrant"),
        ("Built GraphQL APIs for customers.", "GraphQL"),
        ("Built Google Cloud services.", "Google Cloud"),
        ("Google Cloud powers the product.", "Google Cloud"),
        ("Implemented Qdrant with 99% uptime.", "99%"),
    ],
)
def test_opening_action_does_not_hide_invented_claims(text: str, unsupported: str) -> None:
    """The actual technology, proper name, or metric still needs source support."""
    sources = LabeledSources(records={
        "E1": SourceRecord("E1", "experience", "Engineer at Co"),
        "H1": SourceRecord("H1", "highlight", "Developed search services"),
    })
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(
        label="E1", prose=[CitedProse(text=text, source_labels=["H1"])]
    )])

    problems = find_section_problems("experience", draft, sources)

    assert problems
    assert unsupported in problems[0]


@pytest.mark.parametrize(("entry_label", "source_labels"), [("E99", ["H1"]), ("E1", ["H99"])])
def test_unknown_labels_are_rejected(entry_label: str, source_labels: list[str]) -> None:
    """Neither entry identity nor supporting citations may name absent source labels."""
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(
        label=entry_label, prose=[CitedProse(text="Built Python APIs.", source_labels=source_labels)]
    )])

    assert "Unknown" in find_section_problems("experience", draft, _sources())[0]


def test_nothing_fits_must_be_empty() -> None:
    """Saying nothing fits while still returning a role is a problem."""
    draft = TailoredSectionDraft(
        nothing_fits=True, entries=[ChosenEntry(label="E1", prose=[])]
    )

    assert find_section_problems("experience", draft, _sources())


@pytest.mark.parametrize("include_entry", [False, True])
def test_summary_cites_a_credential_without_also_selecting_an_entry(include_entry) -> None:
    """Credential evidence supports summary prose; it must not create a summary entry."""
    sources = LabeledSources(records={"C1": SourceRecord(
        "C1", "certification", "AWS Solutions Architect, Amazon, issued 2024-03-01, expires 2027-03-01")})
    draft = TailoredSectionDraft(nothing_fits=False,
        summary=CitedProse(text="AWS Solutions Architect certified through March 2027.", source_labels=["C1"]),
        entries=[ChosenEntry(label="C1")] if include_entry else [])

    problems = find_section_problems("summary", draft, sources)

    assert bool(problems) is include_entry
    if include_entry:
        assert "summary section does not include entries" in problems[0]
