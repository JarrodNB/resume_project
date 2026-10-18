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


@pytest.mark.parametrize("operation", ["generate", "replace", "feedback"])
def test_worker_reuses_saved_interview_sources(
    operation, task_dependencies, classifier,
):
    """Published successes eliminate classifier requests on a later saved snapshot task."""
    import json

    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message

    saved = set()
    library = CareerLibrary(summary="Python", skills=[LibrarySkill(id="s", name="Stock checking")])
    deps = replace(task_dependencies, read_career_library=lambda _: library,
        read_screening_successes=lambda user, keys: saved.intersection(keys))
    request = task() if operation == "feedback" else _task(operation == "replace")
    request.input["saved_input_snapshot"] = "interview_question_v1"
    agent = interview_feedback_agent if operation == "feedback" else interview_questions_agent
    args = output() if operation == "feedback" else _output(1 if operation == "replace" else 5)
    with agent.override(model=TestModel(custom_output_args=args)):
        for run in range(2):
            queue = FakeResultQueue()
            assert process_task_message(request.model_dump_json(), 1, queue, deps)
            result = json.loads(queue.sent_bodies[-1])
            assert result["status"] == "completed"
            reports = result.get("screening_successes", [])
            if run == 0:
                assert len(reports) == len(classifier)
                assert len(reports) >= 2
                first_calls = list(classifier)
                saved.update((r["content_digest"], r["policy_identity"]) for r in reports)
            else:
                assert classifier == first_calls


@pytest.mark.parametrize("changed_field", ["answer_text", "question_text"])
def test_changed_saved_feedback_text_requires_a_new_check(changed_field, task_dependencies, classifier):
    """An old revision's approval cannot cover edited question or answer bytes."""
    from screening.session import screening_session

    saved = set()
    request = task()
    request.input["saved_input_snapshot"] = "interview_question_v1"
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        with screening_session(lookup_successes=lambda keys: saved.intersection(keys)) as session:
            assert handle_ai_task(request, deps).status == "completed"
            saved.update(session.successes)
        classifier.clear()
        request.input[changed_field] += " More detail."
        with screening_session(lookup_successes=lambda keys: saved.intersection(keys)):
            assert handle_ai_task(request, deps).status == "completed"
    assert classifier == [request.input[changed_field]]


def test_unmarked_feedback_snapshot_cannot_reuse_saved_checks(task_dependencies, classifier):
    """Even matching successful metadata cannot approve unknown task input."""
    from screening.session import screening_session

    request = task()
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    with screening_session(lookup_successes=lambda keys: set(keys)) as session:
        with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
            assert handle_ai_task(request, deps).status == "completed"
        assert not session.successes
    assert classifier == [request.input["answer_text"], request.input["question_text"]]


def test_interviews_share_canonical_fact_response_sources(task_dependencies, classifier):
    """Comparison-approved fact responses reuse while job-derived requirements stay absent."""
    from schemas.gap_analysis_context import LibraryFact
    from screening.library_inputs import library_source_values
    from screening.saved_sources import register_saved_sources
    from screening.screen_user_text import screen_user_text
    from screening.session import screening_session

    library = CareerLibrary(summary="Python", facts=[LibraryFact(
        id="f", requirement="synthetic_attack", response="I organized a workshop.")])
    canonical = library_source_values(library, include_fact_requirements=False)
    saved = set()
    with screening_session() as session:
        register_saved_sources(canonical.sources)
        for text in canonical.sources:
            assert screen_user_text(text, model=task_dependencies.settings.user_text_screen_model,
                timeout_seconds=10, check_phrases=False).allowed
        saved.update(session.successes)
    classifier.clear()
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with (screening_session(lookup_successes=lambda keys: saved.intersection(keys)),
          interview_questions_agent.override(model=TestModel(custom_output_args=_output()))):
        assert handle_ai_task(_task(), deps).status == "completed"
    assert classifier == []
