"""Check the boundary between generated section output and editable resume content.

These cases cover usable shape and supplied labels; prose quality remains for human review.
"""

import pytest

from schemas.tailored_section import ChosenEntry, CitedProse, TailoredSectionDraft
from tailoring.build_section_prompt import build_section_prompt
from tailoring.check_section_output import find_section_problems
from tests.fakes import build_gap_analysis_context


def _sources():
    prompt = build_section_prompt("experience", build_gap_analysis_context(), [], [],
        write_anyway=False, gap_analysis=None)
    return prompt.sources


def test_novel_claims_and_empty_citations_are_usable() -> None:
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="E1", prose=[
        CitedProse(text="Improved the Orion API by 37% for Aurora Labs.", source_labels=[])
    ])])

    assert find_section_problems("experience", draft, _sources()) == []


@pytest.mark.parametrize(("label", "citations"), [("E99", []), ("E1", ["H99"])])
def test_unknown_entry_or_citation_label_is_unusable(label, citations) -> None:
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label=label, prose=[
        CitedProse(text="Built an API.", source_labels=citations)
    ])])

    assert "Unknown" in find_section_problems("experience", draft, _sources())[0]


def test_wrong_entry_kind_is_unusable() -> None:
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="P1")])

    assert "Unknown experience label" in find_section_problems("experience", draft, _sources())[0]


@pytest.mark.parametrize("draft", [
    TailoredSectionDraft(nothing_fits=False),
    TailoredSectionDraft(nothing_fits=False, summary=CitedProse(text="Hi", source_labels=[])),
])
def test_non_summary_requires_own_entries_without_summary(draft) -> None:
    assert find_section_problems("experience", draft, _sources())


def test_summary_requires_nonblank_paragraph_and_no_entries() -> None:
    draft = TailoredSectionDraft(nothing_fits=False,
        summary=CitedProse(text="   ", source_labels=[]), entries=[ChosenEntry(label="E1")])

    problems = find_section_problems("summary", draft, _sources())
    assert len(problems) == 2


def test_summary_accepts_empty_citations() -> None:
    draft = TailoredSectionDraft(nothing_fits=False,
        summary=CitedProse(text="Backend engineer.", source_labels=[]))

    assert find_section_problems("summary", draft, _sources()) == []


def test_summary_rejects_unknown_citation_label() -> None:
    draft = TailoredSectionDraft(nothing_fits=False,
        summary=CitedProse(text="Backend engineer.", source_labels=["UNKNOWN"]))

    assert "Unknown source labels" in find_section_problems("summary", draft, _sources())[0]


def test_nothing_fits_cannot_contain_written_content() -> None:
    draft = TailoredSectionDraft(nothing_fits=True, entries=[ChosenEntry(label="E1")])

    assert find_section_problems("experience", draft, _sources())
