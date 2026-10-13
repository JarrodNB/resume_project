"""
Description: Interview generation dispatch, sparse context, validation, limits, and screening.
Index:
    - test_*: isolated worker behavior with fake readers and TestModel
"""
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel

import text_limits
from agents.interview_questions_agent import interview_questions_agent
from schemas.gap_analysis_context import CareerLibrary, LibraryFact, LibrarySkill
from schemas.interview_questions import QUESTION_CATEGORIES
from screening.screen_user_text import ScreenOutcome
from worker import interview_questions_handler
from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def _task(replacement=False, set_type=None):
    """Builds a valid Rails-shaped question task."""
    data = {"question_set_id": str(uuid4())}
    if set_type is not None:
        data["set_type"] = set_type
    if replacement:
        data.update(question_id=str(uuid4()), question_text="What interests you about Python?",
                    other_questions=[f"Other question {i}?" for i in range(4)],
                    question_revision=1, answer_revision=0)
    return AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), input=data,
        task_type="regenerate_interview_question" if replacement else "generate_interview_questions")


def _output(count=5, set_type="general"):
    """Distinct synthetic drafts grounded in a sparse skill library."""
    questions = [
        "How does Python fit into your background?",
        "What strengths do you bring when using Python?",
        "What would you like to develop in your Python work?",
        "How would you like Python to fit your career goals?",
        "Can you describe an experience learning or using Python?",
    ]
    categories = QUESTION_CATEGORIES[set_type]
    return {"questions": [{"question_text": text, "category": category,
                            "evidence_ids": ["E1"]}
        for text, category in zip(questions[:count],
            categories)]}


@pytest.mark.parametrize("replacement", [False, True])
@pytest.mark.parametrize("set_type", [None, "general", "technical", "knowledge"])
def test_sparse_library_generates_questions(task_dependencies, replacement, set_type, monkeypatch):
    """One stated skill suffices, and both task types report billed usage."""
    library = CareerLibrary(skills=[LibrarySkill(id="skill", name="Python")])
    deps = replace(task_dependencies, read_career_library=lambda user_id: library)
    generate = interview_questions_handler.generate_interview_questions

    def inspect_context(prompt, **kwargs):
        """Verifies the immutable scope reaches the actual agent and prompt."""
        assert prompt.set_type == (set_type or "general")
        assert f"{prompt.set_type} questions" in prompt.text
        return generate(prompt, **kwargs)

    monkeypatch.setattr(interview_questions_handler, "generate_interview_questions", inspect_context)
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output(1 if replacement else 5, set_type or "general"))):
        result = handle_ai_task(_task(replacement, set_type), deps)
    assert result.status == "completed"
    assert len(result.result["interview_questions"]["questions"]) == (1 if replacement else 5)
    assert result.usage
    for question in result.result["interview_questions"]["questions"]:
        assert question["evidence_quotes"] == ["Python"]
        assert "evidence_ids" not in question


@pytest.mark.parametrize("set_type, output_type", [("technical", "general"), ("general", "technical"),
                                                 ("knowledge", "technical"), ("knowledge", "general"),
                                                 ("general", "knowledge"), ("technical", "knowledge")])
def test_wrong_scope_categories_fail(task_dependencies, set_type, output_type):
    """Five distinct but wrong-scope categories cannot be persisted."""
    deps = replace(task_dependencies, read_career_library=lambda user_id: CareerLibrary(summary="Python"))
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output(set_type=output_type))):
        result = handle_ai_task(_task(set_type=set_type), deps)
    assert result.status == "failed"
    assert result.usage


@pytest.mark.parametrize("set_type", ["general", "technical", "knowledge"])
def test_category_prefix_is_not_question_text(task_dependencies, set_type):
    """Internal category labels remain metadata instead of leaking into displayed questions."""
    deps = replace(task_dependencies, read_career_library=lambda user_id: CareerLibrary(summary="Python"))
    draft = _output(set_type=set_type)
    first = draft["questions"][0]
    first["question_text"] = first["category"] + ": " + first["question_text"]
    with interview_questions_agent.override(model=TestModel(custom_output_args=draft)):
        result = handle_ai_task(_task(set_type=set_type), deps)
    assert result.status == "failed"
    assert result.usage


@pytest.mark.parametrize("replacement", [False, True])
@pytest.mark.parametrize("set_type", ["technical", "knowledge"])
def test_nonsoftware_skill_suffices(task_dependencies, replacement, set_type):
    """Practical and knowledge practice accept sparse nontechnology skills."""
    deps = replace(task_dependencies, read_career_library=lambda user_id:
                   CareerLibrary(skills=[LibrarySkill(id="skill", name="Stock checking")]))
    draft = _output(1 if replacement else 5, set_type)
    for question in draft["questions"]:
        question["question_text"] = question["question_text"].replace("Python", "stock checking")
        question["evidence_ids"] = ["E1"]
    with interview_questions_agent.override(model=TestModel(custom_output_args=draft)):
        assert handle_ai_task(_task(replacement, set_type), deps).status == "completed"


@pytest.mark.parametrize("library", [CareerLibrary(), CareerLibrary(summary="  ")])
def test_empty_context_fails_before_model(task_dependencies, library):
    """Empty or whitespace-only context cannot trigger generation."""
    deps = replace(task_dependencies, read_career_library=lambda user_id: library)
    assert "Add usable" in handle_ai_task(_task(), deps).error_message


@pytest.mark.parametrize("problem", ["duplicate", "unsupported_id", "empty_ids", "wrong_count", "old_question"])
@pytest.mark.parametrize("set_type", ["general", "technical", "knowledge"])
def test_invalid_output_fails_cleanly(task_dependencies, problem, set_type):
    """Exhausted validation retries produce an actionable failure."""
    deps = replace(task_dependencies, read_career_library=lambda user_id:
        CareerLibrary(skills=[LibrarySkill(id="skill", name="Python")]))
    output = _output(set_type=set_type)
    replacement = problem == "old_question"
    if problem == "duplicate":
        output["questions"][1] = output["questions"][0]
    elif problem == "unsupported_id":
        output["questions"][0]["evidence_ids"] = ["E999"]
    elif problem == "empty_ids":
        output["questions"][0]["evidence_ids"] = []
    elif problem == "wrong_count":
        output["questions"].pop()
    else:
        output = _output(1, set_type)
        output["questions"][0]["question_text"] = _task(True).input["question_text"]
    with interview_questions_agent.override(model=TestModel(custom_output_args=output)):
        result = handle_ai_task(_task(replacement, set_type), deps)
    assert result.status == "failed"
    assert "valid, distinct" in result.error_message
    assert result.usage
    assert sum(entry.input_tokens for entry in result.usage) > 0
    assert sum(entry.output_tokens for entry in result.usage) > 0


def test_oversized_context_fails_before_model(task_dependencies, monkeypatch):
    """The existing prompt cap applies before the generative agent."""
    monkeypatch.setattr(text_limits, "MAX_PROMPT_TEXT", 10)
    deps = replace(task_dependencies, read_career_library=lambda user_id: CareerLibrary(summary="Python"))
    assert "too long" in handle_ai_task(_task(), deps).error_message


def test_screened_only_context_fails_closed(task_dependencies, monkeypatch):
    """Blocked or unavailable notes cannot leave a generic-question fallback."""
    monkeypatch.setattr("worker.interview_questions_handler.screen_user_text",
                        lambda *args, **kwargs: ScreenOutcome(allowed=False))
    deps = replace(task_dependencies, read_career_library=lambda user_id: CareerLibrary(
        facts=[LibraryFact(id="fact", requirement="Leadership", response="Some details")]))
    assert "Add usable" in handle_ai_task(_task(), deps).error_message


@pytest.mark.parametrize("replacement", [False, True])
@pytest.mark.parametrize("cite_requirement", [False, True])
def test_job_requirement_is_excluded(task_dependencies, monkeypatch, replacement, cite_requirement):
    """Saved responses reach screening and generation; job requirements cannot ground output."""
    requirement = "Experience managing large teams"
    library = CareerLibrary(facts=[LibraryFact(id="fact", requirement=requirement, response="Python")])
    deps = replace(task_dependencies, read_career_library=lambda user_id: library)
    screened = []

    def screen(text, **kwargs):
        """Records exactly what the interview handler submits for screening."""
        screened.append(text)
        return ScreenOutcome(allowed=True)

    monkeypatch.setattr("worker.interview_questions_handler.screen_user_text", screen)
    generate = interview_questions_handler.generate_interview_questions

    def inspect_prompt(prompt, **kwargs):
        """Checks the actual prompt and grounding context before running the test model."""
        assert requirement not in prompt.text
        assert '"requirement"' not in prompt.text
        assert requirement not in prompt.library_text
        assert "Python" in prompt.text and "Python" in prompt.library_text
        return generate(prompt, **kwargs)

    monkeypatch.setattr(interview_questions_handler, "generate_interview_questions", inspect_prompt)
    output = _output(1 if replacement else 5)
    if cite_requirement:
        output["questions"][0]["evidence_ids"] = ["E999"]
    with interview_questions_agent.override(model=TestModel(custom_output_args=output)):
        result = handle_ai_task(_task(replacement), deps)
    assert result.status == ("failed" if cite_requirement else "completed")
    assert screened and all(text.strip() == "Python" for text in screened)
    assert library.facts[0].requirement == requirement


@pytest.mark.parametrize("set_type", ["general", "technical", "knowledge"])
@pytest.mark.parametrize("replacement", [False, True])
def test_evidence_resolution_preserves_original_text(task_dependencies, set_type, replacement):
    """IDs preserve punctuation, Unicode, quotes, and whitespace without model copying."""
    original = '  Built “RAG” on Qdrant; Python → Rails.  '
    deps = replace(task_dependencies, read_career_library=lambda user_id: CareerLibrary(summary=original))
    with interview_questions_agent.override(model=TestModel(custom_output_args=_output(1 if replacement else 5, set_type))):
        result = handle_ai_task(_task(replacement, set_type), deps)
    assert result.status == "completed"
    assert all(question["evidence_quotes"] == [original] for question in result.result["interview_questions"]["questions"])


def test_evidence_catalog_counts_toward_prompt_limit(task_dependencies, monkeypatch):
    """Duplicated evidence context cannot bypass the assembled-prompt cap."""
    original = 'Python knowledge and practice. ' * 50
    monkeypatch.setattr(text_limits, "MAX_PROMPT_TEXT", len(original) + 500)
    deps = replace(task_dependencies, read_career_library=lambda user_id: CareerLibrary(summary=original))
    assert "too long" in handle_ai_task(_task(), deps).error_message
