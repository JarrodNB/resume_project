"""Offline dispatch, sentence coverage, source-only prompts and screening failures."""
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from agents.interview_memory_anchor_agent import interview_memory_anchor_agent
from screening.screen_user_text import ScreenOutcome
from tests.fakes import accounted_override
from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task

ANSWER = "I simplified reporting. It became faster."
OUTPUT = {"cues": [{"sentence": "I simplified reporting.", "cue": "Simplified reporting"}, {"sentence": "It became faster.", "cue": "faster"}]}


@pytest.fixture
def request_and_dependencies(task_dependencies, monkeypatch):
    monkeypatch.setattr("screening.records.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=True, usage=RunUsage(input_tokens=3), model="typesafe:jev-1.13.0"))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_interview_memory_anchor", input={})
    source = {"origin": "generated", "question_set_id": str(uuid4()), "set_type": "technical", "question_id": str(uuid4()), "question_text": "What improved?", "answer_text": ANSWER, "question_revision": 1, "answer_revision": 1}
    def no_library(_user):
        raise AssertionError("Anchors must not read career-library facts")
    return task, replace(task_dependencies, read_interview_question_sources=lambda _task: source, read_career_library=no_library)


def test_anchor_uses_only_answer_and_is_accounted(request_and_dependencies, monkeypatch):
    task, dependencies = request_and_dependencies
    from worker import interview_memory_anchor_handler
    generate = interview_memory_anchor_handler.generate_interview_memory_anchor
    def inspect(text, answer, settings):
        assert ANSWER in text and "What improved?" not in text
        assert '"answer_text"' not in text
        return generate(text, answer, settings)
    monkeypatch.setattr(interview_memory_anchor_handler, "generate_interview_memory_anchor", inspect)
    with accounted_override(interview_memory_anchor_agent, TestModel(custom_output_args=OUTPUT)) as usage:
        result = handle_ai_task(task, dependencies)
    assert result.status == "completed"
    assert result.result == {"memory_anchor": "Simplified reporting → faster"}
    assert len(usage.entries) == 1


@pytest.mark.parametrize("cues", [[OUTPUT["cues"][0]], list(reversed(OUTPUT["cues"])), [{"sentence": ANSWER, "cue": "a" * 601}], [{"sentence": ANSWER, "cue": " "}]])
def test_invalid_output_fails_without_partial_anchor(request_and_dependencies, cues):
    task, dependencies = request_and_dependencies
    with accounted_override(interview_memory_anchor_agent, TestModel(custom_output_args={"cues": cues})):
        result = handle_ai_task(task, dependencies)
    assert result.status == "failed"
    assert result.result is None


def test_stale_sources_fail_before_provider(request_and_dependencies):
    task, dependencies = request_and_dependencies
    result = handle_ai_task(task, replace(dependencies, read_interview_question_sources=lambda _: None))
    assert result.status == "failed"


def test_rejected_answer_never_generates(request_and_dependencies, monkeypatch):
    task, dependencies = request_and_dependencies
    monkeypatch.setattr("screening.records.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=False))
    monkeypatch.setattr("worker.interview_memory_anchor_handler.generate_interview_memory_anchor", lambda *args: pytest.fail("Rejected source reached generation"))
    assert handle_ai_task(task, dependencies).status == "failed"


def test_eval_contract_detects_lost_details_and_sentence_merging():
    from types import SimpleNamespace

    from evals.run_interview_memory_anchor_evals import AnchorContract, load_anchor_dataset
    from schemas.interview_memory_anchor import InterviewMemoryAnchor
    case = load_anchor_dataset().cases[0]
    context = SimpleNamespace(inputs=case.inputs, output=case.expected_output, expected_output=case.expected_output, metadata=case.metadata)
    assert all(AnchorContract().evaluate(context).values())
    context.output = InterviewMemoryAnchor.model_validate({"cues": [{"sentence": case.inputs, "cue": "improved process"}]})
    scores = AnchorContract().evaluate(context)
    assert not scores["sentence_count"] and not scores["key_details"]


def test_known_contact_is_masked_in_the_provider_request_and_restored_in_the_anchor(task_dependencies, monkeypatch):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from privacy.contact_mask import contact_scope, install_contact_hooks
    from privacy.known_contact import KnownContact

    answer = "I emailed jane@example.com. It worked."
    monkeypatch.setattr("screening.records.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=True, usage=RunUsage(input_tokens=3), model="typesafe:jev-1.13.0"))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_interview_memory_anchor", input={})
    source = {"origin": "generated", "question_set_id": str(uuid4()), "set_type": "technical", "question_id": str(uuid4()), "question_text": "What improved?", "answer_text": answer, "question_revision": 1, "answer_revision": 1}
    dependencies = replace(task_dependencies, read_interview_question_sources=lambda _task: source)
    seen = []

    def respond(messages, info):
        seen.extend(str(message) for message in messages)
        cues = [{"sentence": "I emailed «email».", "cue": "Emailed"}, {"sentence": "It worked.", "cue": "worked"}]
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"cues": cues})])

    install_contact_hooks()
    with contact_scope(KnownContact.from_values(emails=["jane@example.com"])), accounted_override(interview_memory_anchor_agent, FunctionModel(respond)):
        result = handle_ai_task(task, dependencies)

    assert result.status == "completed"
    assert "jane@example.com" not in "\n".join(seen)
    assert "«email»" in "\n".join(seen)
