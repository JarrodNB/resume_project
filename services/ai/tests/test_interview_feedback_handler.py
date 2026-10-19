"""
Description: Feedback screening, grounded output, context limits, and usage regressions.
Index:
    - test_*: isolated feedback worker tests using synthetic data and TestModel
"""
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_feedback_agent import interview_feedback_agent
from schemas.gap_analysis_context import CareerLibrary, LibraryFact
from screening.screen_user_text import ScreenOutcome
from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def task():
    """Builds an immutable Rails feedback snapshot."""
    return AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_interview_answer",
        input={"question_set_id": str(uuid4()), "question_id": str(uuid4()),
                   "question_text": "Describe a challenge at work?", "answer_text": "I organized a workshop.",
                   "question_revision": 1, "answer_revision": 2})


def output():
    """Synthetic coaching whose example preserves a placeholder for an unstated outcome."""
    return {"strengths": ["You identify your action."], "improvements": ["Explain the outcome."],
                "example_answer": "I organized a workshop. [add the actual outcome]",
                "evidence_quotes": ["I organized a workshop."]}


@pytest.fixture
def dependencies(task_dependencies, monkeypatch):
    """Allows screening without network calls and uses an empty library."""
    monkeypatch.setattr("worker.interview_feedback_handler.screen_user_text",
        lambda *a, **kw: ScreenOutcome(allowed=True, usage=RunUsage(input_tokens=3), model="typesafe:jev-1.13.0"))
    return replace(task_dependencies, read_career_library=lambda user: CareerLibrary())


@pytest.mark.parametrize("set_type", [None, "general", "technical", "knowledge"])
def test_empty_library_uses_answer_and_reports_usage(dependencies, set_type, monkeypatch):
    """Sparse context still gives grounded feedback; snapshot remains unchanged."""
    request = task()
    if set_type is not None:
        request.input["set_type"] = set_type
    from worker import interview_feedback_handler
    generate = interview_feedback_handler.generate_interview_feedback

    def inspect_context(prompt, **kwargs):
        """Checks type survives prompt assembly for sparse nonsoftware feedback."""
        assert prompt.set_type == (set_type or "general")
        assert f'"set_type": "{prompt.set_type}"' in prompt.text
        return generate(prompt, **kwargs)

    monkeypatch.setattr(interview_feedback_handler, "generate_interview_feedback", inspect_context)
    original = request.model_dump()
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, dependencies)
    assert result.status == "completed"
    assert result.result["interview_feedback"] == output()
    assert len(result.usage) == 3
    assert request.model_dump() == original


def test_knowledge_correction_need_not_copy_incorrect_answer(dependencies):
    """Subject corrections use new vocabulary without mutating saved input or inventing evidence."""
    request = task()
    request.input.update(set_type="knowledge", question_text="How do lists and tuples differ?",
                         answer_text="Lists are immutable but tuples can be appended to.")
    original = request.model_dump()
    draft = {"strengths": ["You compare the two types."],
             "improvements": ["Reverse the mutability claim.", "Explain what mutability means."],
             "example_answer": "Lists are mutable: their elements can change and new items can be appended. "
                               "Tuples are immutable: their sequence cannot change after creation.",
             "evidence_quotes": []}
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(request, dependencies)
    assert result.status == "completed"
    assert result.result["interview_feedback"] == draft
    assert request.model_dump() == original
    assert len(result.usage) == 3


def test_example_can_paraphrase_without_source_vocabulary(dependencies):
    """Illustrative examples keep natural wording rather than reverting to the saved answer."""
    draft = output()
    draft["example_answer"] = "My contribution was putting together a workshop. [Explain why it mattered.]"
    draft["evidence_quotes"] = []
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "completed"
    assert result.result["interview_feedback"] == draft


@pytest.mark.parametrize("wrapper", ['"{}"', '“{}”', "'{}'", '  {}  '])
def test_evidence_presentation_quotes_are_removed(dependencies, wrapper):
    """Exact evidence remains valid when the model adds presentation quotation marks."""
    draft = output()
    draft["evidence_quotes"] = [wrapper.format("I organized a workshop.")]
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "completed"
    assert result.result["interview_feedback"]["evidence_quotes"] == ["I organized a workshop."]


@pytest.mark.parametrize("quote", ['"I organized a workshop with colleagues."', '"I organized workshops."', '" "'])
def test_invalid_evidence_is_discarded(dependencies, quote):
    """Invalid evidence is discarded rather than failing otherwise usable coaching."""
    draft = output()
    draft["evidence_quotes"] = [quote]
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "completed"
    assert result.result["interview_feedback"]["example_answer"] == draft["example_answer"]
    assert result.result["interview_feedback"]["evidence_quotes"] == []
    assert sum(u.output_tokens for u in result.usage) > 0


@pytest.mark.parametrize("unchecked", [False, True])
def test_answer_screen_failure_stops_before_library_read(dependencies, monkeypatch, unchecked):
    """Blocked and unavailable screens preserve usage and never generate."""
    monkeypatch.setattr("worker.interview_feedback_handler.screen_user_text",
        lambda *a, **kw: ScreenOutcome(allowed=False, unchecked=unchecked,
                                      usage=RunUsage(input_tokens=3), model="typesafe:jev-1.13.0"))
    def no_read(user):
        """Fails if rejected text reaches further processing."""
        raise AssertionError("Library should not be read")
    result = handle_ai_task(task(), replace(dependencies, read_career_library=no_read))
    assert result.status == "failed"
    assert "answer is saved" in result.error_message
    assert result.usage[0].input_tokens == 3


@pytest.mark.parametrize("problem", ["unsupported", "invented_actor", "invented_plan", "blank", "missing"])
def test_invalid_feedback_preserves_generation_usage(dependencies, problem):
    """Illustrative prose is accepted; malformed coaching fails with accounted tokens."""
    draft = output()
    if problem == "unsupported":
        draft["evidence_quotes"] = ["Raised revenue by 40%"]
    elif problem == "invented_actor":
        draft["example_answer"] = "I organized a workshop with the hiring manager."
    elif problem == "invented_plan":
        draft["example_answer"] = "I organized a workshop. I will practice weekly [with whom]."
    elif problem == "blank":
        draft["strengths"] = [" "]
    else:
        draft.pop("improvements")
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(task(), dependencies)
    assert result.status == ("completed" if problem in {"unsupported", "invented_actor", "invented_plan"} else "failed")
    if result.status == "completed":
        assert result.result["interview_feedback"]["example_answer"] == draft["example_answer"]
    assert sum(u.output_tokens for u in result.usage) > 0


def test_prompt_limit_prevents_generation(dependencies, monkeypatch):
    """Oversized context fails after screening without a model call."""
    monkeypatch.setattr(text_limits, "MAX_PROMPT_TEXT", 1)
    result = handle_ai_task(task(), dependencies)
    assert result.status == "failed"
    assert "Shorten" in result.error_message
    assert len(result.usage) == 2


def test_excessive_placeholders_fail_with_billed_usage(dependencies):
    """A placeholder checklist cannot bypass the two-placeholder coaching limit."""
    draft = output()
    draft["example_answer"] = "[Add context] [Add action] [Add outcome]"
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "failed"
    assert "answer is saved" in result.error_message
    assert sum(entry.output_tokens for entry in result.usage) > 0


def test_knowledge_example_word_limit_retries_with_usage(dependencies):
    """Knowledge subject explanations cannot exceed the concise 120-word contract."""
    request = task()
    request.input["set_type"] = "knowledge"
    draft = output()
    draft["example_answer"] = "word " * 121
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(request, dependencies)
    assert result.status == "failed"
    assert "answer is saved" in result.error_message
    assert sum(entry.output_tokens for entry in result.usage) > 0


def test_knowledge_example_retry_accepts_concise_correction(dependencies):
    """A too-long subject answer sends a real retry, then accepts a concise corrected response."""
    from pydantic_ai.messages import ModelResponse, RetryPromptPart, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    calls = []
    concise = "Lists are mutable sequences; tuples are immutable sequences."

    def respond(messages, info):
        """Returns an overlong draft first and a concise correction after the validator retries."""
        calls.append(messages)
        draft = output()
        draft["example_answer"] = "word " * 121 if len(calls) == 1 else concise
        draft["evidence_quotes"] = []
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, draft)])

    request = task()
    request.input["set_type"] = "knowledge"
    with interview_feedback_agent.override(model=FunctionModel(respond)):
        result = handle_ai_task(request, dependencies)
    assert result.status == "completed"
    assert result.result["interview_feedback"]["example_answer"] == concise
    assert len(calls) == 2
    assert any(isinstance(part, RetryPromptPart) and "at most 120 words" in part.content
               for message in calls[-1] for part in message.parts)


def test_requirements_and_blocked_notes_are_not_grounding(dependencies, monkeypatch):
    """Job-derived requirements and rejected notes cannot support example facts."""
    screened = []
    def screen(text, **kwargs):
        """Allows the answer while rejecting career notes."""
        screened.append(text)
        return ScreenOutcome(allowed=text in (task().input["answer_text"], task().input["question_text"]))
    monkeypatch.setattr("worker.interview_feedback_handler.screen_user_text", screen)
    library = CareerLibrary(facts=[LibraryFact(id="f", requirement="Managed 20 people", response="Private note")])
    draft = output()
    draft["evidence_quotes"] = ["Managed 20 people"]
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(task(), replace(dependencies, read_career_library=lambda user: library))
    assert result.status == "completed"
    assert result.result["interview_feedback"]["evidence_quotes"] == []
    assert screened[:2] == [task().input["answer_text"], task().input["question_text"]]
    assert "Private note" in screened[2] and "Managed 20 people" in screened[2]
    assert library.facts[0].requirement == "Managed 20 people"


def test_feedback_agent_masks_contact_and_restores_evidence(dependencies, monkeypatch):
    """The registered hook masks answers on provider requests and restores output citations."""
    import json

    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from worker.contact_mask import contact_scope, install_contact_hooks
    from worker.known_contact import KnownContact

    seen = []
    def answer(messages, info):
        """Records outbound content and returns a masked, grounded example."""
        seen.extend(str(message) for message in messages)
        draft = output()
        draft["example_answer"] = "I am «name». [add actual outcome]"
        draft["evidence_quotes"] = ["I am «name»."]
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(draft, ensure_ascii=False))])
    request = task()
    request.input["answer_text"] = "I am Jane Doe."
    install_contact_hooks()
    with contact_scope(KnownContact.from_values(names=["Jane Doe"])), interview_feedback_agent.override(model=FunctionModel(answer)):
        result = handle_ai_task(request, dependencies)
    assert result.status == "completed"
    assert all("Jane Doe" not in text for text in seen)
    assert any("«name»" in text for text in seen)
    assert result.result["interview_feedback"]["evidence_quotes"] == ["I am Jane Doe."]
