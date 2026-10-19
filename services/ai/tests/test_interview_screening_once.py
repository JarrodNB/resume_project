"""Count actual screening requests for interview inputs before fake generation."""

from dataclasses import replace

import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from agents.interview_feedback_agent import interview_feedback_agent
from agents.interview_questions_agent import interview_questions_agent
from agents.user_text_screen_agent import user_text_screen_agent
from schemas.gap_analysis_context import CareerLibrary, LibraryFact, LibrarySkill
from screening.session import screening_session
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
    assert "Python" in classifier[0]
    assert "Stock checking" in classifier[1]
    assert all("Generate 5" not in text for text in classifier)


def test_feedback_screens_answer_question_and_library_once(task_dependencies, classifier):
    """Question and saved answer are required independent inputs."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = task()
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier[:2] == [request.input["answer_text"], request.input["question_text"]]
    assert len(classifier) == 3 and "Python" in classifier[2]


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
    assert "Python" in classifier[0]
    assert classifier[1:] == [request.input["question_text"], *request.input["other_questions"]]


def test_later_task_checks_unapproved_library_again(task_dependencies, classifier):
    """Unchecked database snapshots are checked on each execution until Rails saves approval."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = _task()
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        for _ in range(2):
            assert handle_ai_task(request, deps).status == "completed"
    assert len(classifier) == 2 and all("Python" in text for text in classifier)


def test_required_question_outage_prevents_feedback(task_dependencies, classifier):
    """Unavailable question screening preserves saved-answer failure behavior."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    request = task()
    request.input["question_text"] = "synthetic_outage"
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "failed" and "saved" in result.error_message
    assert len(classifier) == 2


@pytest.mark.parametrize("feedback", [False, True])
def test_checked_library_fields_reused_but_new_fields_screen(task_dependencies, classifier, feedback):
    """A saved name approval never covers a newly used category or a fact requirement."""
    library = CareerLibrary(summary="Python", summary_record_id="user", screened_fields=["summary"],
        skills=[LibrarySkill(id="s", name="Stock checking", category="Operations", screened_fields=["name"])],
        facts=[LibraryFact(id="f", requirement="synthetic_attack", response="Checked inventory")])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    agent = interview_feedback_agent if feedback else interview_questions_agent
    with screening_session() as session, agent.override(
            model=TestModel(custom_output_args=output() if feedback else _output())):
        result = handle_ai_task(task() if feedback else _task(), deps)
        reports = [report.model_dump() for report in session.library_screening]
    assert result.status == "completed"
    library_checks = classifier[2:] if feedback else classifier
    assert len(library_checks) == 2
    assert "Operations" in library_checks[0] and "Stock checking" not in library_checks[0]
    assert "Checked inventory" in library_checks[1]
    assert all("synthetic_attack" not in text for text in classifier)
    assert reports == [
        {"record_type": "skill", "record_id": "s", "fields": ["category"]},
        {"record_type": "library_fact", "record_id": "f", "fields": ["response"]},
    ]
    assert library.skills[0].screened_fields == ["name"]


@pytest.mark.parametrize("feedback", [False, True])
def test_all_checked_library_fields_skip_classifier(task_dependencies, classifier, feedback):
    """Saved approvals also grant exact prompt coverage without leaking their metadata."""
    library = CareerLibrary(summary="Python", screened_fields=["summary"],
        facts=[LibraryFact(id="f", requirement="synthetic_attack", response="Checked inventory",
                           screened_fields=["response"])])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    agent = interview_feedback_agent if feedback else interview_questions_agent
    request = task() if feedback else _task()
    with screening_session() as session, agent.override(
            model=TestModel(custom_output_args=output() if feedback else _output())):
        result = handle_ai_task(request, deps)
        assert not session.library_screening
    assert result.status == "completed"
    assert classifier == ([request.input["answer_text"], request.input["question_text"]] if feedback else [])


def test_checked_oversized_entry_still_omitted(task_dependencies, classifier):
    """Reuse must not bypass the full original source cap or omission warning."""
    library = CareerLibrary(summary="Python", screened_fields=["summary"],
        skills=[LibrarySkill(id="s", name="x" * 80_001, screened_fields=["name"])])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
    assert result.status == "completed"
    assert result.result["warnings"] == ["One of your notes was left out because it is too long."]
    assert classifier == []


@pytest.mark.parametrize("feedback", [False, True])
def test_successful_library_checks_survive_generation_failure(task_dependencies, classifier, monkeypatch, feedback):
    """The worker can publish completed checks even if the generation is invalid."""
    library = CareerLibrary(summary="Python", summary_record_id="user")
    deps = replace(task_dependencies, read_career_library=lambda _: library)

    def invalid(*args, **kwargs):
        raise UnexpectedModelBehavior("Synthetic invalid generation")

    handler = "interview_feedback" if feedback else "interview_questions"
    generate = "generate_interview_feedback" if feedback else "generate_interview_questions"
    monkeypatch.setattr(f"worker.{handler}_handler.{generate}", invalid)
    with screening_session() as session:
        result = handle_ai_task(task() if feedback else _task(), deps)
        assert [(report.record_type, report.record_id, report.fields) for report in session.library_screening] == [
            ("user", "user", ["summary"])]
    assert result.status == "failed"
    if feedback:
        assert "saved" in result.error_message


def test_rejected_library_fields_never_report_approval(task_dependencies, classifier):
    """Optional rejection leaves prior approved summary usable without approving unsafe text."""
    library = CareerLibrary(summary="Python", screened_fields=["summary"],
        skills=[LibrarySkill(id="s", name="synthetic_attack")])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with screening_session() as session, interview_questions_agent.override(
            model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
        assert not session.library_screening
    assert result.status == "completed" and result.result["warnings"]
    assert len(classifier) == 1
