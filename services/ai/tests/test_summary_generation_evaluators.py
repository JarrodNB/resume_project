"""Check the bounded synthetic suite and citation evaluator failure paths offline."""
from types import SimpleNamespace

from evals.run_summary_generation_evals import (
    SummaryCitationValidity,
    load_summary_generation_dataset,
)


def test_cases_cover_full_sparse_and_negative_evidence():
    cases = load_summary_generation_dataset().cases
    assert {case.name for case in cases} == {"backend_evidence", "education_only", "negative_context_is_not_qualification"}
    assert all(not source.screened for case in cases for source in case.inputs.sources)


def test_evaluator_rejects_unknown_and_missing_citations():
    case = load_summary_generation_dataset().cases[0]
    evaluator = SummaryCitationValidity()
    for labels in ([], ["UNKNOWN"], ["EXPERIENCES_1_TITLE"] * 2):
        scores = evaluator.evaluate(SimpleNamespace(inputs=case.inputs, output={"text": "Engineer", "source_labels": labels}))
        assert scores["summary_contract"] == 0.0
    assert evaluator.evaluate(SimpleNamespace(inputs=case.inputs, output={"text": "Engineer", "source_labels": ["EXPERIENCES_1_TITLE"]}))["summary_contract"] == 1.0


def test_runner_generates_cited_output_through_real_handler_without_database(task_dependencies, monkeypatch):
    from pydantic_ai.models.test import TestModel

    from agents.summary_generation_agent import summary_generation_agent
    from evals import run_summary_generation_evals as runner
    from screening.screen_user_text import ScreenOutcome

    def forbidden(*args, **kwargs):
        raise AssertionError("evaluation must not access the database or paid judge")

    monkeypatch.setattr("psycopg.connect", forbidden)
    monkeypatch.setattr(runner, "judge_output", forbidden)
    monkeypatch.setattr(runner, "load_settings", lambda: task_dependencies.settings)
    screened = []
    def screen(text, *args, **kwargs):
        screened.append(text)
        return ScreenOutcome(allowed=True)
    monkeypatch.setattr("screening.records.screen_user_text", screen)
    real_handler = runner.handle_summary_generation_task
    def handle(task, dependencies):
        from database.summary_sources import _fingerprint
        from schemas.summary_generation import SummaryCommand
        command = SummaryCommand.model_validate(task.input)
        assert command.target_id == str(task.user_id)
        assert "sources" not in task.input
        assert "Built Python billing APIs" not in str(task.input)
        evidence = dependencies.read_summary_sources(task.user_id, command)
        references = [reference.model_dump(exclude_none=True) for reference in command.source_references]
        assert command.source_digest == _fingerprint(references)
        assert all(reference.fingerprint == _fingerprint(source.text)
                   for reference, source in zip(command.source_references, evidence.sources, strict=True))
        assert all(not source.screened for source in evidence.sources)
        assert dependencies.read_summary_sources("another-owner", command) is None
        assert dependencies.read_summary_sources(task.user_id, command.model_copy(update={"source_digest": "0" * 64})) is None
        return real_handler(task, dependencies)
    monkeypatch.setattr(runner, "handle_summary_generation_task", handle)
    outputs = []
    def evaluate(factory, generate, **kwargs):
        case = factory().cases[0]
        outputs.append(generate(case.inputs))
        return SimpleNamespace(failures=[], report_evaluator_failures=[], cases=[])
    monkeypatch.setattr(runner, "evaluate_dataset", evaluate)
    with summary_generation_agent.override(model=TestModel(custom_output_args={
            "text": "Backend engineer who built Python billing APIs.", "source_labels": ["EXPERIENCES_1_DESCRIPTION"]})):
        runner.run_summary_generation_evals()
    assert outputs == [{"text": "Backend engineer who built Python billing APIs.",
                        "source_labels": ["EXPERIENCES_1_DESCRIPTION"]}]
    assert screened and "Built Python billing APIs" in screened[0]
