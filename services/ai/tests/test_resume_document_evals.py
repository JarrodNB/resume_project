"""Keep paid evaluation on the whole writer/render/reviewer path with offline contract checks."""

from types import SimpleNamespace

from evals.run_tailoring_evals import load_tailoring_dataset
from evals.tailoring_evaluators import MeasuredResumeContract, ResumeDocumentEvalOutput


def test_whole_document_dataset_and_measured_contracts():
    dataset = load_tailoring_dataset()
    assert len(dataset.cases) == 5
    for case in dataset.cases:
        output = ResumeDocumentEvalOutput(
            markdown="# Candidate\n\nUseful work.",
            page_count=(case.metadata.expected_page_count if case.metadata else 1),
            final_page_occupied_share=0.7,
            editorial_review={
                "feedback": "Clear and relevant.",
                "sufficient_for_target": False,
                "sufficiency_explanation": "The library has no clinical patient-care experience or nursing licensure.",
            },
            warnings=(
                ["The library has no clinical patient-care experience or nursing licensure."]
                if case.metadata and case.metadata.expected_shorter_fallback
                else []
            ),
            drafts=1,
        )
        scores = MeasuredResumeContract().evaluate(
            SimpleNamespace(inputs=case.inputs, output=output, metadata=case.metadata)
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
    assert len(outputs) == len(seen) == 5
    assert all(context.career_library for context, _ in seen)


def test_two_page_cases_share_substantial_library_but_have_opposite_job_specific_expectations():
    from tailoring.library_narrative import narrative_word_count

    cases = [case for case in load_tailoring_dataset().cases if case.inputs.target_pages == 2]
    assert len(cases) == 2
    relevant, unrelated = cases
    assert relevant.inputs.context.career_library == unrelated.inputs.context.career_library
    assert narrative_word_count(relevant.inputs.context.career_library) >= 700
    assert relevant.metadata.expected_page_count == 2
    assert not relevant.metadata.expected_shorter_fallback
    assert unrelated.metadata.expected_page_count == 1
    assert unrelated.metadata.expected_shorter_fallback
    assert unrelated.metadata.fallback_reason_terms
    assert "nursing" in unrelated.inputs.context.job.description
    # Expectations are evaluation metadata, never passed into writer inputs.
    assert "expected_page_count" not in relevant.inputs.model_dump_json()


def test_expected_outcome_scores_catch_length_mismatch_and_vague_fallback():
    cases = [case for case in load_tailoring_dataset().cases if case.inputs.target_pages == 2]
    output = ResumeDocumentEvalOutput(
        markdown="# Candidate",
        page_count=1,
        final_page_occupied_share=0.8,
        editorial_review={
            "feedback": "Fine.",
            "sufficient_for_target": False,
            "sufficiency_explanation": "Not enough information.",
        },
        warnings=["Not enough information."],
        drafts=1,
    )
    score = MeasuredResumeContract().evaluate(
        SimpleNamespace(inputs=cases[0].inputs, output=output, metadata=cases[0].metadata)
    )
    assert score["expected_page_count"] == 0
    score = MeasuredResumeContract().evaluate(
        SimpleNamespace(inputs=cases[1].inputs, output=output, metadata=cases[1].metadata)
    )
    assert score["specific_shorter_fallback"] == 0
