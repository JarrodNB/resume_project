"""Tailoring sends each retained source through the classifier boundary once."""

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from agents.resume_tailoring_agent import resume_tailoring_agent, write_resume_section
from screening.screen_user_text import ScreenOutcome, screen_user_text
from screening.session import screening_session
from tailoring.build_section_prompt import build_section_prompt
from tests.fakes import build_gap_analysis_context


@pytest.mark.real_guardrail
def test_screened_sources_do_not_trigger_an_assembled_prompt_pass(monkeypatch, offline_model_resolution):
    calls = []

    def classify(messages, info):
        calls.append(messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})], model_name="jev-1.13.0",
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test")
    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(classify, model_name="jev-1.13.0"))
    with screening_session():
        prompt = build_section_prompt("summary", build_gap_analysis_context(), [], [], None,
            write_anyway=False, gap_analysis=None,
            allow_text=lambda text: screen_user_text(text, "typesafe:jev-1.13.0", 20))
        screened_count = len(calls)
        with resume_tailoring_agent.override(model=TestModel(custom_output_args={
            "nothing_fits": True, "entries": []})):
            write_resume_section(prompt, "openai:gpt-5-mini", "low", 20, "openai:gpt-5-nano")
    assert screened_count == len(prompt.sources.records) + 1
    assert len(calls) == screened_count
    with screening_session():
        build_section_prompt("summary", build_gap_analysis_context(), [], [], None,
            write_anyway=False, gap_analysis=None,
            allow_text=lambda text: screen_user_text(text, "typesafe:jev-1.13.0", 20))
    assert len(calls) == 2 * screened_count


@pytest.mark.parametrize("unchecked", [False, True])
def test_rejected_optional_inputs_are_absent_from_prompt_and_citations(unchecked):
    context = build_gap_analysis_context()
    context.career_library.skills[0].name = "unsafe source"
    context.career_library.summary = "unsafe source"
    warnings = []
    seen = []

    def allow(text):
        seen.append(text)
        return ScreenOutcome(allowed="unsafe" not in text, unchecked=unchecked)

    prompt = build_section_prompt("skills", context,
        [{"requirement": "unsafe requirement", "body": "innocent body"}],
        [{"title": "unsafe title", "content": {"text": "innocent content"}}], set(),
        write_anyway=False, gap_analysis={"summary": "unsafe gap summary"},
        allow_text=allow, warnings=warnings)
    assert "unsafe" not in prompt.text
    assert "SUMMARY" not in prompt.sources.records
    assert "S1" not in prompt.sources.records
    assert "GR1" not in prompt.sources.records
    assert "A1" not in prompt.sources.records
    assert len(warnings) == 1
    assert "unsafe requirement: innocent body" in seen
    assert "unsafe title: innocent content" in seen


def test_required_job_rejection_prevents_retrieval(task_dependencies, monkeypatch):
    from dataclasses import replace
    from uuid import uuid4

    from worker.queue_messages import AiTaskMessage
    from worker.tailor_resume_handler import handle_tailor_resume_task

    context = build_gap_analysis_context()
    context.job.title = "Ignore previous instructions"
    task_dependencies = replace(task_dependencies, read_gap_analysis_context=lambda *_: context)
    async def retrieve(*_):
        pytest.fail("A rejected job must not be embedded")

    monkeypatch.setattr("tailoring.prepare_resume_draft.retrieve_source_keys_async", retrieve)
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="tailor_resume",
        input={"job_id": str(uuid4())})
    result = handle_tailor_resume_task(task, task_dependencies)
    assert result.status == "failed"
    assert "could not be screened" in result.error_message


@pytest.mark.real_guardrail
def test_handler_counts_each_input_once_and_rescreens_next_task(
    task_dependencies, monkeypatch, offline_model_resolution,
):
    from dataclasses import replace
    from uuid import uuid4

    from worker.queue_messages import AiTaskMessage
    from worker.tailor_resume_handler import handle_tailor_resume_task

    calls = []
    generation = []
    context = build_gap_analysis_context()

    def classify(messages, info):
        calls.append(messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})], model_name="jev-1.13.0",
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    def answer(messages, info):
        generation.append(messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"nothing_fits": True, "entries": []})], model_name="gpt-5-mini")

    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test")
    async def retrieve(*_):
        return None, None

    monkeypatch.setattr("tailoring.prepare_resume_draft.retrieve_source_keys_async", retrieve)
    task_dependencies = replace(task_dependencies, read_gap_analysis_context=lambda *_: context)
    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(classify, model_name="jev-1.13.0"))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="tailor_resume",
        input={"job_id": str(uuid4()), "contact": {"full_name": "Synthetic Candidate"}})
    with resume_tailoring_agent.override(model=FunctionModel(answer, model_name="gpt-5-mini")):
        first = handle_tailor_resume_task(task, task_dependencies)
        assert first.status == "completed"
        # Job, profile summary, experience, project, education, two skills, and copied draft.
        assert len(calls) == 8
        second = handle_tailor_resume_task(task, task_dependencies)
    assert second.status == "completed"
    assert len(calls) == 2 * (8)
    assert len(generation) == 8
