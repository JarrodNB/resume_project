"""Check the boundary between generated section output and editable resume content.

These cases cover usable shape, supplied labels and text not meant for the page; prose quality
remains for human review.
"""

from types import SimpleNamespace

import pytest
from pydantic_ai import ModelRetry

from agents.resume_tailoring_agent import check_section_output
from schemas.tailored_section import ChosenEntry, CitedProse, TailoredSectionDraft
from tailoring.build_section_prompt import build_section_prompt
from tailoring.check_section_output import find_section_problems, find_writing_problems
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


@pytest.mark.parametrize("nothing_fits", [False, True])
def test_experience_cannot_drop_a_role(nothing_fits) -> None:
    from tailoring.labeled_sources import SourceRecord

    sources = _sources()
    sources.records["E2"] = SourceRecord("E2", "experience", "Earlier unrelated job")
    draft = TailoredSectionDraft(nothing_fits=nothing_fits,
        entries=[] if nothing_fits else [ChosenEntry(label="E1")])

    problems = find_section_problems("experience", draft, sources)
    assert "E2" in problems[0]
    assert "Include every experience" in problems[0]


def test_sparse_roles_can_be_kept_without_bullets() -> None:
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="E1")])
    assert find_section_problems("experience", draft, _sources()) == []


def test_experience_cannot_repeat_a_role() -> None:
    draft = TailoredSectionDraft(nothing_fits=False,
        entries=[ChosenEntry(label="E1"), ChosenEntry(label="E1")])
    assert "exactly once" in find_section_problems("experience", draft, _sources())[0]


def _experience_draft(text: str) -> TailoredSectionDraft:
    return TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="E1", prose=[
        CitedProse(text=text, source_labels=[])])])


@pytest.mark.parametrize("text", [
    "Led accessibility work. (The WCAG 2.1 AA claim is not supported by the listed sources; omit.)",
    "Managed monthly close; has not used QuickBooks.",
    "No direct experience with Kubernetes.",
])
def test_text_not_meant_for_the_page_is_found(text: str) -> None:
    assert find_writing_problems(_experience_draft(text))


@pytest.mark.parametrize("text", [
    "Migrated billing data from the source systems to Snowflake.",
    "Site has not had a lost-time incident since the 2022 safety program.",
    "Coached new hires with no prior sales background to quota in 90 days.",
])
def test_ordinary_bullets_are_not_flagged(text: str) -> None:
    assert find_writing_problems(_experience_draft(text)) == []


def test_a_summary_with_a_note_is_found() -> None:
    draft = TailoredSectionDraft(nothing_fits=False, summary=CitedProse(text="Lacks experience in SQL.", source_labels=[]))

    assert find_writing_problems(draft)


def test_writing_problems_get_one_retry_and_never_fail_the_draft() -> None:
    draft = _experience_draft("Managed monthly close; has not used QuickBooks.")
    first_try = SimpleNamespace(deps=SimpleNamespace(section_type="experience", sources=_sources()), retry=0)
    last_try = SimpleNamespace(deps=first_try.deps, retry=1)

    with pytest.raises(ModelRetry, match="lacks"):
        check_section_output(first_try, draft)
    assert check_section_output(last_try, draft) is draft
