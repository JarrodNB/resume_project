"""Count actual screening requests for interview inputs before fake generation."""

import json
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
    assert len(classifier) == 2
    assert json.loads(classifier[0]) == {key: request.input[key] for key in ("question_text", "answer_text")}
    assert classifier[1] == "Python"


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
    assert len(classifier) == 1


def test_replacement_checks_all_excluded_questions_once(task_dependencies, classifier):
    """Previously generated questions are fresh inputs to a later replacement task."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = _task(True)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output(1))):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier[0] == "Python"
    assert [json.loads(source)["question_text"] for source in classifier[1:]] == [request.input["question_text"], *request.input["other_questions"]]


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
    assert len(classifier) == 1


def test_generation_reuses_complete_saved_library_state(task_dependencies, classifier):
    from datetime import UTC, datetime

    from schemas.record_screening import RecordScreeningState
    from screening.records import screening_policy_version
    library = CareerLibrary(summary="Python", skills=[LibrarySkill(id="s", name="Stock checking")])
    now = datetime.now(UTC)
    skill = library.skills[0]
    skill._screening_state = RecordScreeningState("Skill", "s", now, now,
        screening_policy_version(task_dependencies.settings.user_text_screen_model),
        skill.model_dump_json(exclude_none=True))
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
    assert result.status == "completed"
    assert classifier == ["Python"]


def saved_question(request, *, text=None, answer=None, question_id=None):
    from datetime import UTC, datetime

    from screening.records import screening_policy_version
    from worker.settings import load_settings
    return {"question_id": question_id or request.input["question_id"],
        "question_text": text or request.input["question_text"],
        "answer_text": request.input.get("answer_text", "") if answer is None else answer,
        "observed_updated_at": datetime.now(UTC).isoformat(), "screened_at": datetime.now(UTC).isoformat(),
        "screening_policy_version": screening_policy_version(load_settings().user_text_screen_model)}


def test_feedback_reuses_full_saved_question_and_answer(task_dependencies, classifier):
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = task()
    request.input.update(saved_question(request))
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier == ["Python"]


def test_legacy_queued_feedback_cannot_persist_approval(task_dependencies, classifier):
    from screening.session import screening_session
    request = task()
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    with screening_session() as session:
        with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
            result = handle_ai_task(request, deps)
        assert session.screening_successes == []
    assert result.status == "completed"
    assert len(classifier) == 1


def test_replacement_reuses_complete_records_without_exposing_answers(task_dependencies, classifier, monkeypatch):
    from uuid import uuid4

    from worker import interview_questions_handler as handler
    request = _task(True)
    request.input["answer_text"] = "Private saved answer"
    request.input.update(saved_question(request))
    request.input["other_questions"] = [saved_question(request, text=text,
        answer="Another private answer", question_id=str(uuid4())) for text in request.input["other_questions"]]
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    original = handler.generate_interview_questions
    def generate(context, **kwargs):
        assert "Private saved answer" not in context.text
        assert "Another private answer" not in context.text
        assert "screening_policy_version" not in context.text
        assert "observed_updated_at" not in context.text
        assert context.excluded == (request.input["question_text"], *[row["question_text"] for row in request.input["other_questions"]])
        return original(context, **kwargs)
    monkeypatch.setattr(handler, "generate_interview_questions", generate)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output(1))):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier == ["Python"]


def test_unchecked_question_checks_complete_answer_and_reports(task_dependencies, classifier):
    from screening.session import screening_session
    request = task()
    request.input.update(saved_question(request))
    request.input["screened_at"] = None
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    with screening_session() as session:
        with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
            result = handle_ai_task(request, deps)
        assert len(session.screening_successes) == 1
        assert session.screening_successes[0].record_id == request.input["question_id"]
    assert result.status == "completed"
    assert len(classifier) == 1
    assert request.input["question_text"] in classifier[0]
    assert request.input["answer_text"] in classifier[0]


def test_replacement_legacy_questions_do_not_report_approval(task_dependencies, classifier):
    from screening.session import screening_session
    request = _task(True)
    request.input.update(saved_question(request))
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    with screening_session() as session:
        with interview_questions_agent.override(model=TestModel(custom_output_args=_output(1))):
            result = handle_ai_task(request, deps)
        assert session.screening_successes == []
    assert result.status == "completed"
    assert len(classifier) == 5


def test_queue_publishes_question_success_and_next_task_reuses(task_dependencies, classifier):
    import json
    from datetime import UTC, datetime

    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message
    request = task()
    request.input.update(saved_question(request))
    request.input["screened_at"] = None
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    queue = FakeResultQueue()
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        assert process_task_message(request.model_dump_json(), 1, queue, deps)
        finished = json.loads(queue.sent_bodies[-1])
        assert finished["status"] == "completed"
        report, = finished["screening_successes"]
        assert report["record_type"] == "InterviewQuestion"
        assert report["record_id"] == request.input["question_id"]
        request.input["screened_at"] = datetime.now(UTC).isoformat()
        request.input["screening_policy_version"] = report["screening_policy_version"]
        assert process_task_message(request.model_dump_json(), 1, queue, deps)
        assert json.loads(queue.sent_bodies[-1])["status"] == "completed"
    assert len(classifier) == 1


def test_changed_policy_rechecks_full_saved_question(task_dependencies, classifier):
    request = task()
    request.input.update(saved_question(request))
    request.input["screening_policy_version"] = "obsolete"
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        assert handle_ai_task(request, deps).status == "completed"
    assert len(classifier) == 1
    assert request.input["answer_text"] in classifier[0]


def test_rejected_complete_answer_reports_no_approval(task_dependencies, classifier):
    from screening.session import screening_session
    request = task()
    request.input["answer_text"] = "synthetic_attack"
    request.input.update(saved_question(request))
    request.input["screened_at"] = None
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    with screening_session() as session:
        result = handle_ai_task(request, deps)
        assert not session.screening_successes
    assert result.status == "failed" and "saved" in result.error_message
    assert request.input["answer_text"] == "synthetic_attack"
    assert len(classifier) == 1
