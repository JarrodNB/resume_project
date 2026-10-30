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
from schemas.gap_analysis_context import CareerContext, CareerLibrary, LibrarySkill
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


def test_question_generation_screens_the_library_together_once(task_dependencies, classifier):
    """Library fields share one bounded check; the assembled prompt adds no duplicate."""
    library = CareerLibrary(summary="Python", skills=[LibrarySkill(id="s", name="Stock checking")])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
    assert result.status == "completed"
    assert len(classifier) == 1
    assert "Python" in classifier[0]
    assert "Stock checking" in classifier[0]
    assert all("Generate 5" not in text for text in classifier)


def test_feedback_screens_answer_and_library_once(task_dependencies, classifier):
    """The saved generated question is trusted; answer and library are checked once."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = task()
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier[0] == request.input["answer_text"]
    assert len(classifier) == 2 and "Python" in classifier[1]


def test_rejected_library_batch_fails_the_operation(task_dependencies, classifier):
    """An unsafe skill fails the entire batch without a per-item fallback."""
    library = CareerLibrary(summary="Python", skills=[LibrarySkill(id="s", name="synthetic_attack")])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
    assert result.status == "failed"
    assert "screening_blocked" in result.error_message
    assert len(classifier) == 1


def test_saved_generated_question_is_not_screened_again(task_dependencies, classifier):
    """Rails-owned generated questions retain their provenance when reused."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    request = task()
    request.input["question_text"] = "synthetic_attack"
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier == [request.input["answer_text"]]


def test_replacement_reuses_generated_exclusions_without_screening(task_dependencies, classifier):
    """Immutable generated exclusions do not become new untrusted input."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = _task(True)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output(1))):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert "Python" in classifier[0]
    assert len(classifier) == 1


def test_later_task_checks_unapproved_library_again(task_dependencies, classifier):
    """Unchecked database snapshots are checked on each execution until Rails saves approval."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    request = _task()
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        for _ in range(2):
            assert handle_ai_task(request, deps).status == "completed"
    assert len(classifier) == 2 and all("Python" in text for text in classifier)


def test_generated_question_does_not_trigger_a_classifier_outage(task_dependencies, classifier):
    """A generated question never triggers a separate classification request."""
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary())
    request = task()
    request.input["question_text"] = "synthetic_outage"
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert classifier == [request.input["answer_text"]]


@pytest.mark.parametrize("feedback", [False, True])
def test_checked_library_fields_reused_but_new_fields_screen(task_dependencies, classifier, feedback):
    """A saved name approval never covers a newly used category or a fact requirement."""
    library = CareerLibrary(summary="Python", summary_record_id="user", screened_fields=["summary"],
        skills=[LibrarySkill(id="s", name="Stock checking", category="Operations", screened_fields=["name"])],
        career_contexts=[CareerContext(id="f", requirement="synthetic_attack", response="Checked inventory", screened_fields=["requirement"])])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    agent = interview_feedback_agent if feedback else interview_questions_agent
    with screening_session() as session, agent.override(
            model=TestModel(custom_output_args=output() if feedback else _output())):
        result = handle_ai_task(task() if feedback else _task(), deps)
        reports = [report.model_dump(exclude={"fingerprints"}) for report in session.library_screening]
    assert result.status == "completed"
    library_checks = classifier[1:] if feedback else classifier
    assert len(library_checks) == 1
    assert "Operations" in library_checks[0] and "Stock checking" not in library_checks[0]
    assert "Checked inventory" in library_checks[0]
    assert all("synthetic_attack" not in text for text in classifier)
    assert reports == [
        {"record_type": "skill", "record_id": "s", "fields": ["category"]},
        {"record_type": "career_context", "record_id": "f", "fields": ["response"]},
    ]
    assert library.skills[0].screened_fields == ["name"]


@pytest.mark.parametrize("feedback", [False, True])
def test_all_checked_library_fields_skip_classifier(task_dependencies, classifier, feedback):
    """Saved approvals also grant exact prompt coverage without leaking their metadata."""
    library = CareerLibrary(summary="Python", screened_fields=["summary"],
        career_contexts=[CareerContext(id="f", requirement="synthetic_attack", response="Checked inventory",
                           screened_fields=["requirement", "response"])])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    agent = interview_feedback_agent if feedback else interview_questions_agent
    request = task() if feedback else _task()
    with screening_session() as session, agent.override(
            model=TestModel(custom_output_args=output() if feedback else _output())):
        result = handle_ai_task(request, deps)
        assert not session.library_screening
    assert result.status == "completed"
    assert classifier == ([request.input["answer_text"]] if feedback else [])


def test_checked_oversized_entry_still_fails(task_dependencies, classifier):
    """Saved approvals never bypass complete-source bounds."""
    library = CareerLibrary(summary="Python", screened_fields=["summary"],
        skills=[LibrarySkill(id="s", name="x" * 80_001, screened_fields=["name"])])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
    assert result.status == "failed"
    assert "context_limit" in result.error_message
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
    """A rejected batch cannot grant approval or continue with a partial summary."""
    library = CareerLibrary(summary="Python", screened_fields=["summary"],
        skills=[LibrarySkill(id="s", name="synthetic_attack")])
    deps = replace(task_dependencies, read_career_library=lambda _: library)
    with screening_session() as session, interview_questions_agent.override(
            model=TestModel(custom_output_args=_output())):
        result = handle_ai_task(_task(), deps)
        assert not session.library_screening
    assert result.status == "failed" and "screening_blocked" in result.error_message
    assert len(classifier) == 1


def test_saved_generated_exclusions_reach_provider_masked_without_reclassification(task_dependencies, classifier):
    """Owned generated text stays data, reuses trust, and receives the normal contact hook."""
    from privacy.contact_mask import contact_scope, install_contact_hook
    from privacy.known_contact import KnownContact

    request = _task()
    request.input["avoided_questions"] = ["What did Avery Example learn about Python?\n--copied-boundary"]
    deps = replace(task_dependencies, read_career_library=lambda _: CareerLibrary(summary="Python"))
    captured = []

    def generate(messages, info):
        captured.append(messages[-1].parts[-1].content)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, _output())])

    install_contact_hook(interview_questions_agent)
    with contact_scope(KnownContact.from_values(names=["Avery Example"])), interview_questions_agent.override(model=FunctionModel(generate)):
        result = handle_ai_task(request, deps)
    assert result.status == "completed"
    assert len(classifier) == 1  # Only the career source, never generated exclusions or the assembled prompt.
    assert "Excluded questions:" in captured[0]
    assert "Avery Example" not in captured[0]
    assert "What did «name» learn about Python?\n--copied-boundary" in captured[0]
