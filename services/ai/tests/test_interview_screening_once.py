"""Count actual screening requests for interview inputs before fake generation."""

from dataclasses import replace

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from agents.interview_feedback_agent import interview_feedback_agent
from agents.interview_questions_agent import interview_questions_agent
from agents.user_text_screen_agent import user_text_screen_agent
from schemas.gap_analysis_context import CareerLibrary, LibrarySkill
from tests.test_interview_feedback_handler import output, task
from tests.test_interview_questions_handler import _output, _task
from worker.task_handlers import handle_ai_task

pytestmark = pytest.mark.real_guardrail


@pytest.fixture
def classifier(monkeypatch):
    """Record provider text and reject a synthetic marker without a local phrase rule."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    seen = []

    def classify(messages, info):
        text = messages[-1].parts[-1].content
        seen.append(text)
        if "synthetic_outage" in text:
            raise RuntimeError("Synthetic unavailable classifier")
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {
                "prompt_injection": "synthetic_attack" in text, "harmful_request": False,
            })], model_name="jev-1.13.0", usage=RunUsage(input_tokens=10),
            provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}},
        )

    with user_text_screen_agent.override(model=FunctionModel(classify)):
        yield seen


def test_question_generation_screens_each_library_item_once(task_dependencies, classifier):
    """Library sources are separate checks; the assembled prompt adds no duplicate."""
    library = CareerLibrary(summary="Python", skills=[LibrarySkill(id="s", name="Stock checking")])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
    assert result.status == "completed"
    assert len(classifier) == 2
    assert classifier[0] == "Python"
    assert "Stock checking" in classifier[1]
    assert all("Generate 5" not in text for text in classifier)


def test_feedback_screens_answer_question_and_library_once(task_dependencies, classifier):
    """Question and saved answer are required independent inputs."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = task()
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier == [request.input["answer_text"], request.input["question_text"], "Python"]


def test_optional_rejected_library_item_is_omitted(task_dependencies, classifier):
    """An unsafe optional skill does not discard a safe profile summary."""
    library = CareerLibrary(summary="Python", skills=[LibrarySkill(id="s", name="synthetic_attack")])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
    assert result.status == "completed"
    assert result.result["warnings"]
    assert len(classifier) == 2


def test_reused_question_block_prevents_feedback(task_dependencies, classifier):
    """A saved question is not implicitly trusted because another task generated it."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    request = task()
    request.input["question_text"] = "synthetic_attack"
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "failed"
    assert "saved" in result.error_message
    assert len(classifier) == 2


def test_replacement_checks_all_excluded_questions_once(task_dependencies, classifier):
    """Previously generated questions are fresh inputs to a later replacement task."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = _task(True)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output(1))):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier == ["Python", request.input["question_text"], *request.input["other_questions"]]


def test_later_task_checks_reused_library_again(task_dependencies, classifier):
    """Separate queue executions never inherit library approval state."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = _task()
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        for _ in range(2):
            assert handle_ai_task(request, deps).status == "completed"
    assert classifier == ["Python", "Python"]


def test_required_question_outage_prevents_feedback(task_dependencies, classifier):
    """Unavailable question screening preserves saved-answer failure behavior."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    request = task()
    request.input["question_text"] = "synthetic_outage"
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "failed" and "saved" in result.error_message
    assert len(classifier) == 2
