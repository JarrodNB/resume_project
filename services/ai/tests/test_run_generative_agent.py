"""Check the shared agent run: deadline, failure type, and that spent requests are still billed.

The final test goes through the queue seam, because that is where the published usage
comes from. Handlers no longer report usage; every real model request does.
"""
import time
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

from llm.run_generative_agent import GenerativeOutputInvalid, run_generative_agent
from llm.usage import AccountedModel
from schemas.study_guide import StudyGuideInput
from screening.session import screening_session
from tests.fakes import accounted_override
from tests.test_process_task_message import FakeResultQueue, build_task_body
from worker import main
from worker.queue_messages import AiResultMessage


def numbers_agent():
    return Agent(output_type=int, retries=1, defer_model_check=True)


def run(agent, **overrides):
    return run_generative_agent(
        agent, "give me a number", model="openai:gpt-5-mini", fallback_model="openai:gpt-5-mini",
        thinking=None, timeout_seconds=5, prompt_version="test-1", **overrides,
    )


def test_returns_the_validated_output():
    agent = numbers_agent()
    with agent.override(model=TestModel(custom_output_args=7)):
        assert run(agent).output == 7


def test_exhausted_output_retries_raise_one_typed_error_and_every_request_is_billed():
    agent = Agent(output_type=int, retries=1, defer_model_check=True)

    @agent.output_validator
    def reject(value):
        from pydantic_ai import ModelRetry
        raise ModelRetry("never good enough")

    with accounted_override(agent, TestModel(custom_output_args=1)) as usage, pytest.raises(GenerativeOutputInvalid):
        run(agent)
    assert len(usage.entries) == 2


def test_run_shares_the_deadline_already_spent_by_screening():
    agent = numbers_agent()
    with screening_session(0.01):
        time.sleep(0.05)
        with agent.override(model=TestModel(custom_output_args=1)), pytest.raises(TimeoutError):
            run(agent)


def test_queue_result_lists_requests_even_when_generation_never_validates(task_dependencies):
    from agents.study_guide_agent import study_guide_agent

    dependencies = replace(
        task_dependencies,
        read_study_guide_sources=lambda task: StudyGuideInput.model_validate(task.input),
    )
    queue = FakeResultQueue()
    body = build_task_body(
        task_type="generate_study_guide",
        input={"job_id": str(uuid4()), "description": "Reconcile stock counts against records."},
    )
    invalid = TestModel(custom_output_args={"title": "Invalid", "topics": []})
    with study_guide_agent.override(model=AccountedModel(invalid)):
        assert main.process_task_message(body, 1, queue, dependencies)
    final = AiResultMessage.model_validate_json(queue.sent_bodies[-1])
    assert final.status == "failed"
    assert final.error_message == "The AI could not produce a valid study guide. Try again."
    assert len(final.usage) == 3 and all(entry.output_tokens > 0 for entry in final.usage)
