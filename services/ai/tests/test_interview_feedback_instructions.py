"""
Description: Actual feedback provider requests isolate subject corrections from personal scaffolds.
Index:
    - test_provider_receives_scope_specific_instructions: trusted scopes select exclusive policies
"""
import json
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from agents.interview_feedback_agent import interview_feedback_agent
from prompts.interview_feedback_instructions import INTERVIEW_FEEDBACK_INSTRUCTIONS
from prompts.interview_knowledge_feedback_instructions import (
    INTERVIEW_KNOWLEDGE_FEEDBACK_INSTRUCTIONS,
)
from schemas.gap_analysis_context import CareerLibrary
from screening.screen_user_text import ScreenOutcome
from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


@pytest.mark.parametrize("set_type", ["general", "technical", "knowledge"])
def test_provider_receives_scope_specific_instructions(task_dependencies, monkeypatch, set_type):
    """Exercises the real handler/agent request so knowledge never receives personal-only rules."""
    monkeypatch.setattr("screening.records.screen_user_text",
                        lambda *args, **kwargs: ScreenOutcome(allowed=True))
    deps = replace(task_dependencies, read_career_library=lambda user: CareerLibrary())
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_interview_answer",
        input={"question_set_id": str(uuid4()), "question_id": str(uuid4()), "set_type": set_type,
               "question_text": "How do lists and tuples differ?", "answer_text": "Lists cannot change.",
               "question_revision": 1, "answer_revision": 1})
    seen = []

    def respond(messages, info):
        """Captures the actual provider's selected policy and returns valid structured coaching."""
        seen.append(info.instructions)
        draft = {"strengths": ["You attempt a comparison."],
                 "improvements": ["Explain the difference."],
                 "example_answer": "Lists are mutable sequences; tuples are immutable sequences.",
                 "evidence_quotes": []}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, json.dumps(draft))])

    with interview_feedback_agent.override(model=FunctionModel(respond)):
        result = handle_ai_task(task, deps)
    assert result.status == "completed"
    assert seen and all(instructions for instructions in seen)
    for instructions in seen:
        assert ("GENERAL BEHAVIORAL COACHING" in instructions) == (set_type == "general")
        if set_type == "technical":
            assert instructions == INTERVIEW_FEEDBACK_INSTRUCTIONS.strip()
        if set_type == "knowledge":
            assert instructions == INTERVIEW_KNOWLEDGE_FEEDBACK_INSTRUCTIONS.strip()
            assert "Supply a DIRECT, corrected illustrative SUBJECT answer" in instructions
            assert "Do not replace missing subject knowledge" in instructions
            assert "Professional knowledge and your coaching suggestions are NOT" not in instructions
            assert "A sparse answer requires a short scaffold" not in instructions
        else:
            assert "Professional knowledge and your coaching suggestions are NOT" in instructions
            assert "A sparse answer requires a short scaffold" in instructions
            assert "Supply a DIRECT, corrected illustrative SUBJECT answer" not in instructions
