"""Keep paid evaluation on the whole writer/render/reviewer path with offline contract checks."""

from types import SimpleNamespace

from evals.run_tailoring_evals import load_tailoring_dataset
from evals.tailoring_evaluators import MeasuredResumeContract, ResumeDocumentEvalOutput


def test_whole_document_dataset_and_measured_contracts():
    dataset = load_tailoring_dataset()
    assert len(dataset.cases) == 3
    for case in dataset.cases:
        output = ResumeDocumentEvalOutput(
            markdown="# Candidate\n\nUseful work.",
            page_count=1,
            final_page_occupied_share=0.7,
            editorial_review={"feedback": "Clear and relevant."},
            warnings=[],
            drafts=1,
        )
        scores = MeasuredResumeContract().evaluate(
            SimpleNamespace(inputs=case.inputs, output=output)
        )
        assert all(value == 1.0 for value in scores.values())


def test_runner_delegates_full_context_to_production_pipeline(monkeypatch):
    from evals import run_tailoring_evals as runner

    seen = []

    async def generate(user, data, dependencies, *, usage):
        context = dependencies.read_gap_analysis_context(user, data.job_id)
        seen.append((context, data.target_pages))
        return SimpleNamespace(
            markdown="# Sample",
            measurements={"page_count": 1, "final_page_occupied_share": 0.5},
            editorial_review={"feedback": "Reviewed"},
            warnings=[],
            drafts=1,
        )

    def evaluate(load_dataset, task, **kwargs):
        return [task(case.inputs) for case in load_dataset().cases]

    monkeypatch.setattr(runner, "generate_resume_draft", generate)
    monkeypatch.setattr(runner, "evaluate_dataset", evaluate)
    outputs = runner.run_tailoring_evals()
    assert len(outputs) == len(seen) == 3
    assert all(context.career_library for context, _ in seen)
