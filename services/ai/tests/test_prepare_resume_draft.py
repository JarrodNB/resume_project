"""Prepare one draft through real screening policy and controlled provider boundaries."""

import asyncio
from collections import Counter
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai.usage import RunUsage

from agents.user_text_screen_agent import UserTextScreenRun
from schemas.user_text_screen import UserTextScreen
from screening.session import current_session, prompt_is_covered, screening_session
from tests.fakes import build_gap_analysis_context


def allowed_run(text):
    return UserTextScreenRun(UserTextScreen(prompt_injection="attack" in text, harmful_request=False),
        "jev-1.13.0", {"prompt_injection": 1., "harmful_request": 1.}, RunUsage(input_tokens=7))


@pytest.fixture
def preparation(task_dependencies, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")
    context = build_gap_analysis_context()
    reads = []
    calls = []
    retrievals = []
    user_id, job_id = uuid4(), uuid4()

    def read(user, job):
        reads.append((user, job))
        return context

    async def classify(text, model, timeout):
        calls.append(text)
        return allowed_run(text)

    async def retrieve(user, section, job, settings):
        assert context.job.model_dump_json(exclude_none=True, exclude={"responsibilities"}) in current_session().allowed_sources
        assert user == user_id
        retrievals.append(section)
        return None, None

    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", classify)
    monkeypatch.setattr("tailoring.prepare_resume_draft.retrieve_source_keys_async", retrieve)
    return replace(task_dependencies, read_gap_analysis_context=read), context, reads, calls, retrievals, user_id, job_id


def test_shared_evidence_once_exact_prompts_and_fresh_execution(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, reads, calls, retrievals, user, job = preparation

    async def run():
        usage, warnings = [], []
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies, usage=usage, warnings=warnings)
            assert set(prepared.prompts) == {"summary", "experience", "projects", "skills"}
            assert all(prompt_is_covered(prompt.text) for prompt in prepared.prompts.values())
            assert not prompt_is_covered(prepared.prompts["skills"].text + " unknown")
            for prompt in prepared.prompts.values():
                assert "SUMMARY" in prompt.sources.records
            summary = await prepared.summary_prompt([{"title": "Experience", "content": {"text": "Selected draft"}}])
            assert "Selected draft" in summary.text
            assert prompt_is_covered(summary.text)
        assert all(count == 1 for count in Counter(calls).values())
        assert sum(item.input_tokens for item in usage) == len(calls) * 7
        first_count = len(calls)
        with screening_session():
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
        assert len(calls) > first_count
    asyncio.run(run())
    assert reads == [(user, job), (user, job)]
    assert retrievals == ["summary", "experience"] * 2


def test_required_rejection_before_retrieval_and_optional_omission(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, _, retrievals, user, job = preparation
    context.job.title = "attack"

    async def run():
        with screening_session(), pytest.raises(ValueError, match="job context"):
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
        assert not retrievals
        context.job.title = "Engineer"
        context.career_library.summary = "attack"
        context.career_library.skills[0].name = "attack"
        warnings = []
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=warnings)
            assert all("attack" not in prompt.text for prompt in prepared.prompts.values())
            assert all("SUMMARY" not in prompt.sources.records for prompt in prepared.prompts.values())
        assert warnings == ["One of your notes was left out."]
    asyncio.run(run())


def test_bounded_overlap_and_awaited_cancellation(preparation, monkeypatch):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, _, _, user, job = preparation

    async def run():
        active = 0
        peak = 0
        started = asyncio.Event()
        release = asyncio.Event()
        cancelled = []

        async def classify(text, model, timeout):
            nonlocal active, peak
            if text.startswith('{"id":"job-'):
                return allowed_run(text)
            active += 1
            peak = max(peak, active)
            if active == 2:
                started.set()
            try:
                await release.wait()
                return allowed_run(text)
            finally:
                active -= 1
                cancelled.append(text)

        monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", classify)
        with screening_session():
            task = asyncio.create_task(prepare_resume_draft(user, job, dependencies, usage=[], warnings=[], concurrency=2))
            await asyncio.wait_for(started.wait(), 2)
            assert peak == 2
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert active == 0
            assert len(cancelled) == 2
    asyncio.run(run())


def test_summary_uses_selected_stable_labels_and_rejects_later_execution(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, _, _, user, job = preparation

    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            summary = await prepared.summary_prompt(
                [{"title": "Skills", "content": {"items": [{"name": "PostgreSQL"}]}}], selected_labels={"S2"})
            assert set(summary.sources.records) == {"S2", "A1"}
            assert prompt_is_covered(summary.text)
        with screening_session(), pytest.raises(RuntimeError, match="Prepare evidence again"):
            await prepared.summary_prompt([])
    asyncio.run(run())


@pytest.mark.real_guardrail
def test_real_guardrail_reuses_coverage_and_preserves_task_privacy(
    task_dependencies, monkeypatch, offline_model_resolution, tmp_path,
):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai.models.test import TestModel
    from pydantic_ai_harness import InputBlocked

    from agents.resume_tailoring_agent import resume_tailoring_agent
    from conversation_logging import conversation_scope
    from tailoring.prepare_resume_draft import prepare_resume_draft
    from worker.contact_mask import contact_scope, current_known_contact
    from worker.known_contact import KnownContact
    from worker.queue_messages import AiTaskMessage
    from worker.task_usage import collect_task_usage, current_task_usage

    monkeypatch.chdir(tmp_path)
    context = build_gap_analysis_context()
    context.career_library.summary = "Synthetic Person builds software"
    contact = KnownContact.from_values(names=["Synthetic Person"])
    dependencies = replace(task_dependencies, read_gap_analysis_context=lambda *_: context)
    seen = []
    accounting = None

    async def classify(messages, info):
        assert current_known_contact() is contact
        assert current_task_usage() is accounting
        text = messages[-1].parts[-1].content
        seen.append(text)
        assert "Synthetic Person" not in text
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": "attack" in text, "harmful_request": False})],
            model_name="jev-1.13.0", usage=RunUsage(input_tokens=7),
            provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}})

    async def retrieve(*_):
        return None, None

    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")
    monkeypatch.setattr("tailoring.prepare_resume_draft.retrieve_source_keys_async", retrieve)
    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(classify, model_name="jev-1.13.0"))

    async def run():
        nonlocal accounting
        task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="tailor_resume", input={"job_id": str(uuid4())})
        settings = dependencies.settings.model_copy(update={"worker_environment": "local", "conversation_logging_enabled": True})
        with (contact_scope(contact), collect_task_usage() as accounting, screening_session(),
              conversation_scope(task, settings, uuid4(), 1)):
            usage = []
            prepared = await prepare_resume_draft(uuid4(), uuid4(), dependencies, usage=usage, warnings=[])
            count = len(seen)
            prompt = prepared.prompts["summary"]
            with resume_tailoring_agent.override(model=TestModel(custom_output_args={"nothing_fits": True, "entries": []})):
                await resume_tailoring_agent.run(prompt.text, deps=prompt)
                assert len(seen) == count
                with pytest.raises(InputBlocked):
                    await resume_tailoring_agent.run(prompt.text + " attack", deps=prompt)
            assert len(seen) == count + 1
            assert sum(item.input_tokens for item in usage) == count * 7
            assert sum(item.input_tokens for item in accounting.entries if "jev" in item.model) == len(seen) * 7
        logs = list(tmp_path.glob("conversation_logs/**/*.md"))
        assert len(logs) == 1
        transcript = logs[0].read_text()
        assert "Synthetic Person" not in transcript
        assert "«name»" in transcript
        assert transcript.count("Request snapshot") == len(seen)
        assert str(task.ai_task_id) in transcript
    asyncio.run(run())


def test_summary_selected_labels_can_come_from_other_writers(preparation, monkeypatch):
    """Summary retrieval must not hide evidence selected by another section's writer."""
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, _, _, user, job = preparation

    async def retrieve(_user, section, _job, _settings):
        return ({("Skill", "skill-1")} if section == "summary" else None), None

    monkeypatch.setattr("tailoring.prepare_resume_draft.retrieve_source_keys_async", retrieve)

    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert "S2" not in prepared.prompts["summary"].sources.records
            summary = await prepared.summary_prompt([], selected_labels={"S2"})
            assert set(summary.sources.records) == {"S2"}
            assert prompt_is_covered(summary.text)
    asyncio.run(run())


def test_cancelled_real_screen_requests_keep_known_usage_and_mark_unknown_costs(
    task_dependencies, monkeypatch, offline_model_resolution,
):
    """Provider cancellation is awaited and does not erase already received screen usage."""
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from tailoring.prepare_resume_draft import prepare_resume_draft
    from worker.task_usage import collect_task_usage

    context = build_gap_analysis_context()
    dependencies = replace(task_dependencies, read_gap_analysis_context=lambda *_: context)
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")

    async def retrieve(*_):
        return None, None

    monkeypatch.setattr("tailoring.prepare_resume_draft.retrieve_source_keys_async", retrieve)

    async def run():
        started = asyncio.Event()
        blocked = asyncio.Event()
        active = 0
        stopped = []

        async def classify(messages, info):
            nonlocal active
            text = messages[-1].parts[-1].content
            if not text.startswith('{"id":"job-'):
                active += 1
                if active == 2:
                    started.set()
                try:
                    await blocked.wait()
                finally:
                    active -= 1
                    stopped.append(text)
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
                {"prompt_injection": False, "harmful_request": False})], model_name="jev-1.13.0",
                usage=RunUsage(input_tokens=7),
                provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}})

        offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(classify, model_name="jev-1.13.0"))
        with collect_task_usage() as accounting, screening_session():
            usage = []
            task = asyncio.create_task(prepare_resume_draft(uuid4(), uuid4(), dependencies,
                usage=usage, warnings=[], concurrency=2))
            await asyncio.wait_for(started.wait(), 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert active == 0
            assert len(stopped) == 2
            assert sum(item.input_tokens for item in usage) == 7
            assert sum(item.input_tokens for item in accounting.entries) == 7
            assert accounting.incomplete
    asyncio.run(run())


def test_saved_canonical_sources_reuse_and_changed_role_checks_again(preparation):
    """A later task reuses saved units while generated section snapshots still screen."""
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation

    async def run():
        with screening_session() as first:
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
        successes = {(row.content_digest, row.policy_identity) for row in first.successes.values()}
        assert successes
        first_count = len(calls)
        with screening_session(lookup_successes=lambda keys: set(keys) & successes):
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert len(calls) == first_count
            summary = await prepared.summary_prompt([{"title": "Experience", "content": {"text": "New draft"}}])
            assert prompt_is_covered(summary.text)
            assert len(calls) == first_count + 1
        context.career_library.experiences[0].title = "Changed role"
        before = len(calls)
        with screening_session(lookup_successes=lambda keys: set(keys) & successes):
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert len(calls) == before + 1
            assert "Changed role" in prepared.prompts["experience"].text
            assert prompt_is_covered(prepared.prompts["experience"].text)
    asyncio.run(run())


def test_rejected_whole_role_keeps_safe_selected_highlight_with_stable_labels(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation
    context.career_library.experiences[0].highlights[1].content = "attack"

    async def run():
        warnings = []
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=warnings)
            prompt = prepared.prompts["experience"]
            assert "H1" in prompt.sources.records
            assert "H2" not in prompt.sources.records
            assert "E1" in prompt.sources.records
            assert "attack" not in prompt.text
            assert prompt_is_covered(prompt.text)
            assert "Senior Engineer at Now Co: Built Python APIs" in session.allowed_sources
            # This fallback really received its own classifier pass.
            assert "Senior Engineer at Now Co: Built Python APIs" in calls
        assert warnings == ["One of your notes was left out."]
    asyncio.run(run())


def test_canonical_projection_never_approves_unknown_direct_prompts(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, _, _, user, job = preparation

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            prompt = prepared.prompts["experience"]
            projection = prompt.sources.records["H1"].text
            assert projection not in session.allowed_sources
            assert not prompt_is_covered(projection)
            assert prompt_is_covered(prompt.text)
            assert not prompt_is_covered(prompt.text + " unchecked extra")
    asyncio.run(run())


def test_changed_highlight_checks_one_unit_and_updates_context(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation

    async def run():
        with screening_session() as first:
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
        context.career_library.experiences[0].highlights[0].content = "Built a new service"
        before = len(calls)
        with screening_session(lookup_successes=lambda keys: set(keys) & first.successes.keys()):
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert len(calls) == before + 1
            assert "Built a new service" in prepared.prompts["experience"].sources.records["H1"].text
            assert prompt_is_covered(prepared.prompts["experience"].text)
    asyncio.run(run())


def test_gap_analysis_approvals_reuse_exact_shared_tailoring_units(
    preparation, monkeypatch, offline_model_resolution,
):
    from datetime import date

    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from gap_analysis.prepare_gap_analysis import prepare_gap_analysis
    from screening.job_inputs import job_source_values
    from screening.library_inputs import library_source_values
    from screening.saved_sources import register_saved_sources
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation

    def classify(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})], model_name="jev-1.13.0",
            provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}})

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(classify, model_name="jev-1.13.0"))
    with screening_session() as comparison:
        register_saved_sources((*job_source_values(context.job), *library_source_values(context.career_library).sources))
        prepared = prepare_gap_analysis(context, today=date(2026, 1, 1),
            screen_model=dependencies.settings.user_text_screen_model, timeout_seconds=30)
        assert prepared.error_message is None

    async def run():
        with screening_session(lookup_successes=lambda keys: set(keys) & comparison.successes.keys()):
            draft = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert calls == []
            assert all(prompt_is_covered(prompt.text) for prompt in draft.prompts.values())
    asyncio.run(run())


def test_uploaded_resume_check_does_not_approve_imported_library_units(preparation):
    from screening.screen_user_text import screen_user_text_async
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation

    async def run():
        with screening_session() as upload:
            assert (await screen_user_text_async(context.career_library.model_dump_json(),
                dependencies.settings.user_text_screen_model, 30,
                classify=lambda *args: _upload_allowed(*args))).allowed
        assert not upload.successes
        calls.clear()
        with screening_session(lookup_successes=lambda keys: set(keys) & upload.successes.keys()):
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
        assert calls

    async def _upload_allowed(text, *_):
        return allowed_run(text)

    asyncio.run(run())
