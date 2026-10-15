"""
Description: Capability screening costs survive successful and blocked SQS tasks.
Index:
    - test_*: result usage, no generation on rejection, and stale-generation metadata
"""

import json

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputGuardrail

from agents.user_text_screen_agent import UserTextScreenRun
from schemas.user_text_screen import UserTextScreen
from screening.prompt_guardrail import screen_prompt
from tests.test_process_task_message import FakeResultQueue, build_task_body
from worker import main
from worker.queue_messages import AiResultMessage


@pytest.mark.parametrize("blocked", [False, True])
def test_task_reports_guardrail_costs_and_generation(blocked, monkeypatch, task_dependencies) -> None:
    """Blocked tasks retain Jev costs and the tailoring revision without generating output."""
    generated = []

    async def classify(*_args):
        """Reports a priced Jev decision from a fake screening provider."""
        return UserTextScreenRun(
            UserTextScreen(prompt_injection=blocked, harmful_request=False), "jev-1.13.0",
            {"prompt_injection": 1.0, "harmful_request": 1.0}, RunUsage(input_tokens=100),
        )

    def handler(task, _dependencies):
        """Runs a capability-protected agent just as a production task handler does."""
        agent = Agent(TestModel(), capabilities=[InputGuardrail(guard=screen_prompt)])
        agent.run_sync("Stored career data")
        generated.append(True)
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed")

    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", classify)
    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    body = build_task_body(task_type="tailor_resume", input={"generation": 3})
    # Repeated tasks must each have their own usage collection, with no leakage.
    for _ in range(2):
        assert main.process_task_message(body, 1, queue, task_dependencies)
    for raw in queue.sent_bodies:
        result = json.loads(raw)
        if not result["attempt_finished"]:
            continue
        assert result["status"] == ("failed" if blocked else "completed")
        assert len(result["usage"]) == 1
        assert result["usage"][0]["model"] == "jev-1.13.0"
        assert result["usage"][0]["input_tokens"] == 100
        if blocked:
            assert result["generation"] == 3
            assert result["result"] is None
    assert len(generated) == (0 if blocked else 2)
