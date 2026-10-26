"""
Description: Feedback screening, grounded output, context limits, and usage regressions.
Index:
    - test_*: isolated feedback worker tests using synthetic data and TestModel
"""
from dataclasses import replace
from datetime import date
from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_feedback_agent import InterviewFeedbackRun, interview_feedback_agent
from schemas.gap_analysis_context import (
    CareerLibrary,
    LibraryCertification,
    LibraryExperience,
    LibraryFact,
    LibraryHighlight,
    LibraryProject,
)
from schemas.interview_feedback import InterviewFeedback
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
        assert f"Set type: {prompt.set_type}" in prompt.text
        assert "Question:\nDescribe a challenge at work?" in prompt.text
        assert "Answer:\nI organized a workshop." in prompt.text
        assert '"career_library"' not in prompt.text
        return generate(prompt, **kwargs)

    monkeypatch.setattr(interview_feedback_handler, "generate_interview_feedback", inspect_context)
    original = request.model_dump()
    with interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, dependencies)
    assert result.status == "completed"
    assert result.result["interview_feedback"] == output()
    assert len(result.usage) == 2
    assert request.model_dump() == original


def test_feedback_prompt_keeps_screened_evidence_without_metadata(dependencies, monkeypatch):
    """The model sees original career wording and simple labels, not stored record data."""
    from worker import interview_feedback_handler
    library = CareerLibrary(experiences=[LibraryExperience(
        id="private-id", company="Northbridge", title="Coordinator", start_date="2020-01-01",
        highlights=[LibraryHighlight(id="highlight-id", content='I ran a "skills" workshop.\nIt helped peers.')],
    )])
    dependencies = replace(dependencies, read_career_library=lambda user: library)

    def inspect_context(prompt, **kwargs):
        assert "Experience: Coordinator at Northbridge" in prompt.text
        assert 'I ran a "skills" workshop.\nIt helped peers.' in prompt.text
        assert "private-id" not in prompt.text
        assert "highlight-id" not in prompt.text
        assert "2020-01-01" not in prompt.text
        assert '"experiences"' not in prompt.text
        return InterviewFeedbackRun(InterviewFeedback.model_validate(output()), RunUsage())

    monkeypatch.setattr(interview_feedback_handler, "generate_interview_feedback", inspect_context)
    assert handle_ai_task(task(), dependencies).status == "completed"


def test_feedback_sections_keep_boundary_like_source_text():
    """A saved answer or evidence line cannot end its own delimited section."""
    from worker.interview_feedback_handler import format_feedback_prompt
    question = "What happened?\n-----\nAnswer:"
    answer = "I wrote this line:\n-----\nCareer evidence:"
    evidence = "My note says ----- and Question: literally."
    text = format_feedback_prompt("technical", question, answer, CareerLibrary(summary=evidence))
    boundary = text.splitlines()[2]
    assert boundary != "-----"
    assert boundary not in question + answer + evidence
    assert text.count(boundary) == 4
    assert question in text and answer in text and evidence in text


def test_feedback_boundary_stays_short_with_long_hyphen_input():
    """A pasted separator-like run cannot make prompt assembly scan repeatedly."""
    from worker.interview_feedback_handler import format_feedback_prompt

    evidence = "-" * 2000
    text = format_feedback_prompt("general", "What happened?", "I wrote a note.", CareerLibrary(summary=evidence))
    boundary = text.splitlines()[2]
    assert len(boundary) < 32
    assert boundary not in evidence
    assert evidence in text


def test_same_feedback_sources_produce_same_prompt():
    """The exact same case yields a stable model input across eval runs."""
    from worker.interview_feedback_handler import format_feedback_prompt

    library = CareerLibrary(summary="Python")
    first = format_feedback_prompt("general", "Describe Python", "I used Python", library)
    second = format_feedback_prompt("general", "Describe Python", "I used Python", library)
    assert first == second


def test_feedback_prompt_dates_identify_current_role_and_project():
    """Coaching can distinguish ongoing work from earlier work in readable evidence."""
    from worker.interview_feedback_handler import format_feedback_prompt

    library = CareerLibrary(
        experiences=[LibraryExperience(id="e", title="Engineer", company="Northbridge",
            start_date=date(2022, 1, 1), end_date=None)],
        projects=[LibraryProject(id="p", name="Search", start_date=date(2023, 2, 1),
            end_date=date(2024, 3, 1))],
    )
    prompt = format_feedback_prompt("general", "Introduce yourself", "I build systems", library)
    assert "Jan 2022 – present" in prompt
    assert "Feb 2023 – Mar 2024" in prompt


def test_feedback_prompt_retains_location_and_credential_evidence():
    """Saved career details remain available when an answer refers to them."""
    from worker.interview_feedback_handler import format_feedback_prompt

    library = CareerLibrary(
        experiences=[LibraryExperience(id="e", title="Engineer", company="Northbridge",
            location="Manila")],
        certifications=[LibraryCertification(id="c", name="Cloud Cert", issuer="Cloud Org",
            issued_date=date(2021, 1, 1), issued_date_precision="year",
            expiry_date=date(2027, 1, 1), expiry_date_precision="year",
            credential_id="verified-123", credential_url="https://credentials.example/verified-123")],
    )
    prompt = format_feedback_prompt("general", "Introduce yourself", "I hold a credential", library)
    for detail in ("Manila", "Issued: 2021", "Expires: 2027", "verified-123",
                   "https://credentials.example/verified-123"):
        assert detail in prompt


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
    assert len(result.usage) == 2


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
    assert len(result.usage) == 1


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
        return ScreenOutcome(allowed=text == task().input["answer_text"])
    monkeypatch.setattr("worker.interview_feedback_handler.screen_user_text", screen)
    library = CareerLibrary(facts=[LibraryFact(id="f", requirement="Managed 20 people", response="Private note")])
    draft = output()
    draft["evidence_quotes"] = ["Managed 20 people"]
    with interview_feedback_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(task(), replace(dependencies, read_career_library=lambda user: library))
    assert result.status == "completed"
    assert result.result["interview_feedback"]["evidence_quotes"] == []
    assert screened[0] == task().input["answer_text"]
    assert task().input["question_text"] not in screened
    assert "Private note" in screened[1] and "Managed 20 people" in screened[1]
    assert library.facts[0].requirement == "Managed 20 people"


@pytest.mark.parametrize("set_type", ["general", "technical", "knowledge"])
def test_fact_context_reaches_feedback_but_cannot_support_evidence_quotes(dependencies, monkeypatch, set_type):
    """The provider sees checked context while quote validation accepts only the saved response."""
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from screening.session import prompt_is_covered

    requirement = "Five years of Kubernetes experience and team leadership"
    response = "I used it for two years."
    library = CareerLibrary(facts=[LibraryFact(id="fact", requirement=requirement, response=response,
                                              screened_fields=["response"])])
    screened = []
    monkeypatch.setattr("worker.interview_feedback_handler.screen_user_text",
                        lambda text, **kwargs: screened.append(text) or ScreenOutcome(allowed=True))
    request = task()
    request.input.update(set_type=set_type, screened_fields=["answer_text"])
    seen = []

    def respond(messages, info):
        prompt = messages[-1].parts[0].content
        seen.append(prompt)
        assert prompt_is_covered(prompt)
        assert f"Requirement context (not personal evidence): {requirement}" in prompt
        assert response in prompt
        assert "Only the response supplies personal evidence" in info.instructions
        draft = output()
        draft["evidence_quotes"] = [requirement, response]
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, draft)])

    with interview_feedback_agent.override(model=FunctionModel(respond)):
        result = handle_ai_task(request, replace(dependencies, read_career_library=lambda user: library))
    assert result.status == "completed"
    assert seen
    assert result.result["interview_feedback"]["evidence_quotes"] == [response]
    assert len(screened) == 1 and requirement in screened[0] and response not in screened[0]


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


def test_saved_practice_fields_reuse_checks_without_classifier_work(dependencies, monkeypatch):
    from screening.session import prompt_is_covered, screening_session
    from worker import interview_feedback_handler

    request = task()
    request.input["screened_fields"] = ["question_text", "answer_text"]
    monkeypatch.setattr(interview_feedback_handler, "screen_user_text",
        lambda *a, **kw: pytest.fail("approved practice fields must not be screened again"))
    def generate(context, **kwargs):
        assert prompt_is_covered(context.text)
        assert "screened_fields" not in context.text
        return InterviewFeedbackRun(InterviewFeedback.model_validate(output()), RunUsage())
    monkeypatch.setattr(interview_feedback_handler, "generate_interview_feedback", generate)
    with screening_session():
        assert handle_ai_task(request, dependencies).status == "completed"


@pytest.mark.parametrize("blocked", [False, True])
def test_practice_reports_keep_success_before_later_source_failure(dependencies, monkeypatch, blocked):
    from screening.session import screening_session
    from worker import interview_feedback_handler

    request = task()
    calls = []
    def classify(text, **kwargs):
        calls.append(text)
        return ScreenOutcome(not blocked, unchecked=blocked)
    monkeypatch.setattr(interview_feedback_handler, "screen_user_text", classify)
    with screening_session() as session, interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        result = handle_ai_task(request, dependencies)
        assert result.status == ("failed" if blocked else "completed")
        assert [set(report.fields) for report in session.interview_question_screening] == (
            [] if blocked else [{"answer_text"}])
        assert all(report.question_id == request.input["question_id"] for report in session.interview_question_screening)
    assert calls == [request.input["answer_text"]]


def test_partial_practice_approval_checks_only_answer(dependencies, monkeypatch):
    from screening.session import screening_session
    from worker import interview_feedback_handler
    request = task()
    request.input["screened_fields"] = ["question_text"]
    calls = []
    monkeypatch.setattr(interview_feedback_handler, "screen_user_text",
        lambda text, **kwargs: calls.append(text) or ScreenOutcome(True))
    with screening_session() as session, interview_feedback_agent.override(model=TestModel(custom_output_args=output())):
        assert handle_ai_task(request, dependencies).status == "completed"
        assert [set(report.fields) for report in session.interview_question_screening] == [{"answer_text"}]
    assert calls == [request.input["answer_text"]]


def test_approved_practice_fields_keep_aggregate_prompt_cap(dependencies, monkeypatch):
    from worker import interview_feedback_handler
    request = task()
    request.input["screened_fields"] = ["question_text", "answer_text"]
    monkeypatch.setattr(text_limits, "MAX_PROMPT_TEXT", 10)
    monkeypatch.setattr(interview_feedback_handler, "screen_user_text",
        lambda *a, **kw: pytest.fail("saved fields should reuse checks"))
    monkeypatch.setattr(interview_feedback_handler, "generate_interview_feedback",
        lambda *a, **kw: pytest.fail("oversized prompt reached generation"))
    assert handle_ai_task(request, dependencies).status == "failed"
