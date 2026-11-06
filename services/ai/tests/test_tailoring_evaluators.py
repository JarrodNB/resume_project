"""Check synthetic quality labels and the paid runner's generated-section boundary.

Copied resume sections must never reach a generative evaluation call. Their identities,
descriptions, and date precision have separate deterministic production-path regressions.
"""

import pytest

from evals.run_tailoring_evals import load_tailoring_dataset
from evals.tailoring_evaluators import labels_to_draft


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case the draft its labels describe scores 1.0 everywhere."""
    dataset = load_tailoring_dataset()
    assert len(dataset.cases) >= 8

    def answer(case_input):
        """The hand-labelled draft for this case."""
        labels = next(case.metadata for case in dataset.cases if case.inputs == case_input)
        assert labels is not None
        return labels_to_draft(labels)

    report = dataset.evaluate_sync(answer, progress=False)

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores


def test_runner_generates_only_production_written_sections(monkeypatch) -> None:
    """Paid evaluation calls must never generate copied education or certifications."""
    from pydantic_ai.usage import RunUsage

    from agents.resume_tailoring_agent import TailoringRun
    from evals import run_tailoring_evals as runner
    from schemas.tailored_section import TailoredSectionDraft
    from tailoring.section_catalog import WRITTEN_SECTIONS

    sections = []
    answer_prompts = []

    def write(prompt, **_):
        sections.append(prompt.section_type)
        if "GR1" in prompt.sources.records:
            answer_prompts.append(prompt.text)
        return TailoringRun(TailoredSectionDraft(nothing_fits=True), RunUsage())

    def evaluate(load_dataset, task, **_):
        return [task(case.inputs) for case in load_dataset().cases]

    monkeypatch.setattr(runner, "write_resume_section", write)
    monkeypatch.setattr(runner, "evaluate_dataset", evaluate)
    runner.run_tailoring_evals()

    assert len(answer_prompts) == 1
    assert "presented quarterly retention findings to senior leaders" in answer_prompts[0]
    assert set(sections) == set(WRITTEN_SECTIONS)
    assert len(sections) == len(load_tailoring_dataset().cases)


@pytest.mark.parametrize("section", ["education", "certifications", "contact"])
def test_copied_sections_cannot_enter_paid_eval_inputs(section) -> None:
    from evals.tailoring_evaluators import TailorEvalInput

    context = load_tailoring_dataset().cases[0].inputs.context
    with pytest.raises(ValueError, match="generated section"):
        TailorEvalInput(section_type=section, context=context)


@pytest.mark.parametrize("retained", ["answer", "highlight", "citation_only"])
def test_evidence_coverage_detects_lost_facts(retained) -> None:
    """Either missing achievement lowers recall; citations without wording prove nothing."""
    from types import SimpleNamespace

    from evals.tailoring_evaluators import EvidenceCoverage
    from schemas.tailored_section import ChosenEntry, CitedProse, TailoredSectionDraft

    case = next(case for case in load_tailoring_dataset().cases
                if case.name == "gap_answer_preserves_existing_churn_evidence")
    texts = {
        "answer": ("Presented retention findings to senior leaders.", ["GR1"]),
        "highlight": ("Built churn reports reducing churn 12%.", ["H1"]),
        "citation_only": ("Maintained the team calendar.", ["H1", "GR1"]),
    }
    text, sources = texts[retained]
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="E1", prose=[
        CitedProse(text=text, source_labels=sources)])])
    context = SimpleNamespace(inputs=case.inputs, metadata=case.metadata, output=draft)
    assert EvidenceCoverage().evaluate(context) == (0 if retained == "citation_only" else 0.5)
