"""Exercise description-only guide generation through the queue dispatch interface."""
from uuid import uuid4

import pytest

from screening.screen_user_text import ScreenOutcome


@pytest.fixture(autouse=True)
def allow_description(monkeypatch):
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=True))

from pydantic_ai.models.test import TestModel

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def task(description="Reconcile inventory records and physical stock counts."):
    return AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_study_guide",
                         input={"job_id": str(uuid4()), "description": description})


def test_generates_from_the_frozen_description_without_library(task_dependencies):
    from agents.study_guide_agent import study_guide_agent

    with study_guide_agent.override(model=TestModel()):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "completed"
    guide = result.result["study_guide"]
    assert guide["version"] == 1
    assert len(guide["questions"]) == 5
    assert all(question["question"] and question["answer"] and question["example"] for question in guide["questions"])


@pytest.mark.parametrize("description", ["", " ", "x" * 20_001])
def test_invalid_description_fails_before_generation(task_dependencies, description):
    assert handle_ai_task(task(description), task_dependencies).status == "failed"


def test_rejected_description_never_reaches_the_writer(task_dependencies, monkeypatch):
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=False))
    def forbidden(*args):
        raise AssertionError("blocked source reached generator")
    monkeypatch.setattr("worker.study_guide_handler.generate_study_guide", forbidden)
    result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.result == {"failure_code": "input_rejected"}


def test_prompt_uses_only_the_snapshot_and_output_failures_are_recoverable(task_dependencies, monkeypatch):
    from pydantic_ai.exceptions import UnexpectedModelBehavior
    seen = []
    def reject(prompt, settings):
        seen.append(prompt)
        raise UnexpectedModelBehavior("bad shape")
    monkeypatch.setattr("worker.study_guide_handler.generate_study_guide", reject)
    result = handle_ai_task(task("Frozen description with stock reconciliation."), task_dependencies)
    assert seen == ["Create study material for this job description (source data):\n\n<job_description>\nFrozen description with stock reconciliation.\n</job_description>"]
    assert result.status == "failed"
    assert "valid study guide" in result.error_message


def test_screening_outage_is_distinct_from_rejected_source(task_dependencies, monkeypatch):
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=False, unchecked=True))
    result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.result == {"failure_code": "screening_unavailable"}
    assert "unavailable" in result.error_message


@pytest.mark.real_guardrail
def test_screened_description_covers_the_exact_prompt_once(task_dependencies, monkeypatch):
    from pydantic_ai.usage import RunUsage

    from agents.study_guide_agent import study_guide_agent
    from agents.user_text_screen_agent import UserTextScreenRun
    from schemas.user_text_screen import UserTextScreen
    from screening.screen_user_text import screen_user_text

    seen = []
    def classify(text, **kwargs):
        seen.append(text)
        return UserTextScreenRun(UserTextScreen(prompt_injection=False, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1.0, "harmful_request": 1.0}, RunUsage(input_tokens=10))
    async def forbidden(*args):
        raise AssertionError("assembled prompt was screened twice")
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", screen_user_text)
    monkeypatch.setattr("screening.screen_user_text.screen_user_message", classify)
    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", forbidden)
    with study_guide_agent.override(model=TestModel()):
        request = task("Maintain stock records.")
        request.input["previous_questions"] = ["How do you count stock?"]
        result = handle_ai_task(request, task_dependencies)
    assert result.status == "completed"
    assert seen == ["Maintain stock records."]
    assert result.usage[0].input_tokens == 10


def test_invalid_model_output_exhausts_repair_with_usage_retained(task_dependencies):
    from agents.study_guide_agent import study_guide_agent

    with study_guide_agent.override(model=TestModel(custom_output_args={"title": "Invalid", "topics": []})):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert result.usage
    assert result.usage[-1].output_tokens > 0


def test_unusable_description_fails_clearly_without_inventing_questions(task_dependencies):
    from agents.study_guide_agent import study_guide_agent

    with study_guide_agent.override(model=TestModel(seed=1, custom_output_args={
        "cannot_generate_reason": "Add a meaningful job description with duties to study.",
    })):
        result = handle_ai_task(task("The clouds were beautiful."), task_dependencies)
    assert result.status == "failed"
    assert result.result == {"failure_code": "insufficient_description"}
    assert "job description" in result.error_message
    assert result.usage[-1].output_tokens > 0


@pytest.mark.parametrize("count", [4, 6])
def test_incomplete_or_oversized_batch_cannot_complete(task_dependencies, count):
    from agents.study_guide_agent import study_guide_agent

    question = {"question": "How do you reconcile stock?", "why_it_matters": "The role reconciles stock.",
                "answer": "Compare counts and check receipts to explain discrepancies.", "example": "10 recorded minus 8 counted leaves 2 to investigate."}
    with study_guide_agent.override(model=TestModel(custom_output_args={
        "version": 1, "title": "Stock", "questions": [question] * count,
    })):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert result.usage[-1].output_tokens > 0

@pytest.mark.real_guardrail
def test_saved_questions_are_readable_trusted_context_without_repeat_screening(task_dependencies, monkeypatch):
    from pydantic_ai.exceptions import UnexpectedModelBehavior
    seen = []
    screened = []
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", lambda value, **kw: screened.append(value) or ScreenOutcome(allowed=True))
    def generate(prompt, settings):
        seen.append(prompt)
        raise UnexpectedModelBehavior("test stop after observing context")
    monkeypatch.setattr("worker.study_guide_handler.generate_study_guide", generate)
    request = task()
    request.input["previous_questions"] = ["How do you count stock?", "Why investigate count differences?"]
    result = handle_ai_task(request, task_dependencies)
    assert seen
    assert "Previous saved study questions" in seen[0]
    assert "1. How do you count stock?" in seen[0]
    assert "2. Why investigate count differences?" in seen[0]
    assert '"previous_questions"' not in seen[0]
    assert screened == [request.input["description"]]
    assert result.status == "failed"


@pytest.mark.parametrize("previous", [["Question?"] * 201, ["x" * 1000] * 41])
def test_prior_context_limit_fails_without_silently_dropping_questions(task_dependencies, monkeypatch, previous):
    def forbidden(*args, **kwargs):
        raise AssertionError("oversized context reached generation or screening")
    monkeypatch.setattr("worker.study_guide_handler.generate_study_guide", forbidden)
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", forbidden)
    request = task()
    request.input["previous_questions"] = previous
    assert handle_ai_task(request, task_dependencies).status == "failed"


def test_generated_diagram_survives_the_worker_result(task_dependencies):
    from agents.study_guide_agent import study_guide_agent

    diagram = {"caption": "Stock reconciliation", "explanation": "Compare the physical count with the stock record before investigating differences.",
               "nodes": [{"id": "count", "label": "Physical count"}, {"id": "record", "label": "Recorded stock"}],
               "edges": [{"from_node": "count", "to_node": "record", "label": "Compare with"}]}
    question = {"question": "How do you reconcile stock?", "why_it_matters": "The role reconciles stock.",
                "answer": "Compare counts and check receipts to explain discrepancies.", "example": "10 recorded minus 8 counted leaves 2 to investigate.",
                "diagram": diagram}
    with study_guide_agent.override(model=TestModel(custom_output_args={
        "version": 1, "title": "Stock", "questions": [question] * 5,
    })):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "completed"
    assert result.result["study_guide"]["questions"][0]["diagram"] == diagram


@pytest.mark.parametrize("change", ["missing_node", "duplicate_id", "too_many_nodes", "too_many_edges", "oversized_label", "markup_field", "unused_node", "self_loop", "duplicate_edge"])
def test_invalid_diagram_cannot_complete_and_retains_usage(task_dependencies, change):
    from agents.study_guide_agent import study_guide_agent

    diagram = {"caption": "Reconciliation", "explanation": "Compare counts and records.",
               "nodes": [{"id": "count", "label": "Count"}, {"id": "record", "label": "Record"}],
               "edges": [{"from_node": "count", "to_node": "record", "label": "Compare"}]}
    if change == "missing_node":
        diagram["edges"][0]["to_node"] = "missing"
    elif change == "duplicate_id":
        diagram["nodes"][1]["id"] = "count"
    elif change == "too_many_nodes":
        diagram["nodes"] *= 4
    elif change == "too_many_edges":
        diagram["edges"] *= 9
    elif change == "oversized_label":
        diagram["nodes"][0]["label"] = "x" * 161
    elif change == "markup_field":
        diagram["html"] = "<script>alert(1)</script>"
    elif change == "unused_node":
        diagram["nodes"].append({"id": "unused", "label": "Unused"})
    elif change == "self_loop":
        diagram["edges"][0]["to_node"] = "count"
    elif change == "duplicate_edge":
        diagram["edges"] *= 2
    question = {"question": "How do you reconcile stock?", "why_it_matters": "The role reconciles stock.",
                "answer": "Compare physical and recorded counts.", "example": "A count of 10 differs from 12 by 2.", "diagram": diagram}
    with study_guide_agent.override(model=TestModel(custom_output_args={"version": 1, "title": "Stock", "questions": [question] * 5})):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert result.usage[-1].output_tokens > 0
