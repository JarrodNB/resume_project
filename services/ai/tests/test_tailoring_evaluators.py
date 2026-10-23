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

    def write(prompt, **_):
        sections.append(prompt.section_type)
        return TailoringRun(TailoredSectionDraft(nothing_fits=True), RunUsage())

    def evaluate(load_dataset, task, **_):
        return [task(case.inputs) for case in load_dataset().cases]

    monkeypatch.setattr(runner, "write_resume_section", write)
    monkeypatch.setattr(runner, "evaluate_dataset", evaluate)
    runner.run_tailoring_evals()

    assert set(sections) == set(WRITTEN_SECTIONS)
    assert len(sections) == len(load_tailoring_dataset().cases)


@pytest.mark.parametrize("section", ["education", "certifications", "contact"])
def test_copied_sections_cannot_enter_paid_eval_inputs(section) -> None:
    from evals.tailoring_evaluators import TailorEvalInput

    context = load_tailoring_dataset().cases[0].inputs.context
    with pytest.raises(ValueError, match="generated section"):
        TailorEvalInput(section_type=section, context=context)


def test_eval_runner_passes_page_choice_and_allowance_to_real_prompt(monkeypatch):
    """A live quality comparison must exercise the same length guidance as production."""
    from pydantic_ai.usage import RunUsage

    from agents.resume_tailoring_agent import TailoringRun
    from evals import run_tailoring_evals as runner
    from evals.tailoring_evaluators import TailorEvalInput
    from schemas.tailored_section import TailoredSectionDraft

    prompts = []
    context = load_tailoring_dataset().cases[0].inputs.context
    case = TailorEvalInput(section_type="experience", context=context,
                          target_page_count=1, word_allowance=123)

    def write(prompt, **_):
        prompts.append(prompt.text)
        return TailoringRun(TailoredSectionDraft(nothing_fits=True), RunUsage())

    monkeypatch.setattr(runner, "write_resume_section", write)
    monkeypatch.setattr(runner, "evaluate_dataset", lambda _load, task, **_: task(case))
    runner.run_tailoring_evals()
    assert "Resume target: 1 pages" in prompts[0]
    assert "Section allowance: 123 words" in prompts[0]


def test_evidence_coverage_penalizes_omitted_distinct_achievements():
    """A fluent faithful short section must not score as complete on a rich two-page case."""
    from pydantic_evals import Case, Dataset

    from evals.tailoring_evaluators import EvidenceCoverage, TailorEvalLabels
    from schemas.tailored_section import ChosenEntry, CitedProse, TailoredSectionDraft

    case_input = load_tailoring_dataset().cases[0].inputs
    labels = TailorEvalLabels(nothing_fits=False, entry_label="E1",
                             source_labels=["H1", "H2", "H3", "H4"])
    dataset = Dataset(name="evidence-coverage", cases=[Case(inputs=case_input, metadata=labels)],
                      evaluators=[EvidenceCoverage()])
    draft = TailoredSectionDraft(nothing_fits=False, entries=[ChosenEntry(label="E1", prose=[
        CitedProse(text="Built Python APIs.", source_labels=["H1", "H1"])])])
    report = dataset.evaluate_sync(lambda _: draft, progress=False)
    assert report.averages().scores["EvidenceCoverage"] == 0.25
