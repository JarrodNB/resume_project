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
        assert context.job.model_dump_json(exclude_none=True) in current_session().allowed_sources
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
            if text.startswith('{"id":"job-1"'):
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
            if not text.startswith('{"id":"job-1"'):
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


def test_saved_record_approval_covers_full_record_and_exact_prompt(preparation):
    from datetime import UTC, datetime

    from schemas.record_screening import RecordScreeningState
    from screening.records import screening_policy_version
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation
    now = datetime.now(UTC)
    for record, kind in [(context.job, "Job"),
                         *[(item, "Experience") for item in context.career_library.experiences]]:
        record._screening_state = RecordScreeningState(kind, record.id, now, now,
            screening_policy_version(dependencies.settings.user_text_screen_model),
            record.model_dump_json(exclude_none=True))

    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert all(prompt_is_covered(prompt.text) for prompt in prepared.prompts.values())
            assert not any(context.job.title in text for text in calls)
            assert not any(context.career_library.experiences[0].company in text for text in calls)
    asyncio.run(run())


def test_full_record_hidden_fields_are_screened_without_broadening_prompt(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation
    context.career_library.projects[0].role = "hidden role attack"
    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert "P1" not in prepared.prompts["projects"].sources.records
            assert any("hidden role attack" in text for text in calls)
    asyncio.run(run())


@pytest.mark.parametrize("changed", ["policy", "content", "none"])
def test_saved_approvals_rescreen_changed_policy_or_complete_content(preparation, changed):
    from datetime import UTC, datetime

    from schemas.record_screening import RecordScreeningState
    from screening.records import screening_policy_version
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation
    record = context.career_library.projects[0]
    now = datetime.now(UTC)
    policy = screening_policy_version(dependencies.settings.user_text_screen_model)
    record._screening_state = RecordScreeningState("Project", record.id, now, now,
        "old-policy" if changed == "policy" else policy, record.model_dump_json(exclude_none=True))
    if changed == "content":
        record.role = "A newly edited role"

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert all(prompt_is_covered(prompt.text) for prompt in prepared.prompts.values())
            assert any(record.name in text for text in calls) == (changed != "none")
            reports = [item for item in session.screening_successes if item.record_id == record.id]
            assert len(reports) == (1 if changed == "policy" else 0)
            assert ("A newly edited role" in prepared.prompts["projects"].text) is False
    asyncio.run(run())


@pytest.mark.parametrize("approved", [False, True])
def test_saved_gap_answer_uses_screening_fields_from_rails(preparation, approved):
    from datetime import UTC, datetime

    from screening.records import screening_policy_version
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, calls, _, user, job = preparation
    now = datetime.now(UTC)
    snapshot = {"id": str(uuid4()), "requirement": "gap requirement", "body": "saved gap answer",
           "updated_at": now.isoformat(), "screened_at": now.isoformat() if approved else None,
           "screening_policy_version": screening_policy_version(dependencies.settings.user_text_screen_model)}

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[], gap_responses=[snapshot])
            assert "gap requirement: saved gap answer" in prepared.prompts["summary"].text
            assert prompt_is_covered(prepared.prompts["summary"].text)
            assert any("saved gap answer" in text for text in calls) == (not approved)
            assert any(item.record_id == snapshot["id"] for item in session.screening_successes) == (not approved)
    asyncio.run(run())


def test_gap_analysis_successes_reuse_in_later_tailoring(preparation):
    from datetime import UTC, date, datetime

    from agents.user_text_screen_agent import user_text_screen_agent
    from gap_analysis.prepare_gap_analysis import prepare_gap_analysis
    from schemas.record_screening import RecordScreeningState
    from tailoring.prepare_resume_draft import prepare_resume_draft
    from tests.test_gap_context_screening import jev_model

    dependencies, context, _, calls, _, user, job = preparation
    now = datetime.now(UTC)
    records = [(context.job, "Job")]
    for field, kind in [("experiences", "Experience"), ("projects", "Project"),
                        ("educations", "Education"), ("certifications", "Certification"),
                        ("skills", "Skill"), ("facts", "LibraryFact")]:
        records.extend((item, kind) for item in getattr(context.career_library, field))
    for record, kind in records:
        record._screening_state = RecordScreeningState(kind, record.id, now, None, None,
            record.model_dump_json(exclude_none=True))
    with screening_session() as session, user_text_screen_agent.override(model=jev_model([])):
        result = prepare_gap_analysis(context, today=date(2026, 10, 19),
            screen_model=dependencies.settings.user_text_screen_model, timeout_seconds=20)
        assert result.prompt is not None
        successes = {item.record_id: item for item in session.screening_successes}
    for record, _kind in records:
        record._screening_state = replace(record._screening_state, screened_at=now,
            screening_policy_version=successes[record.id].screening_policy_version)

    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert all(prompt_is_covered(prompt.text) for prompt in prepared.prompts.values())
            assert calls == [context.career_library.summary]
    asyncio.run(run())


@pytest.mark.real_guardrail
@pytest.mark.parametrize("name", ["José Álvarez", 'Ana "Annie" Doe'])
def test_unicode_gap_response_masks_provider_requests_and_reuses_saved_approval(
    task_dependencies, monkeypatch, offline_model_resolution, name,
):
    import json
    from datetime import UTC, datetime

    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from agents.resume_tailoring_agent import write_resume_section_async
    from screening.records import screening_policy_version
    from tailoring.prepare_resume_draft import prepare_resume_draft
    from worker.contact_mask import contact_scope, install_contact_hooks
    from worker.known_contact import KnownContact

    install_contact_hooks()
    escaped_name = json.dumps(name)[1:-1]
    contact = KnownContact.from_values(names=[name])
    context = build_gap_analysis_context()
    now = datetime.now(UTC)
    row = {"id": str(uuid4()), "requirement": "Unicode gap requirement", "body": f"{name} built services",
           "updated_at": now, "screened_at": None, "screening_policy_version": None}
    snapshot = {key: row[key] for key in ("id", "requirement", "body")}
    snapshot["updated_at"] = now.isoformat()
    dependencies = replace(task_dependencies, read_gap_analysis_context=lambda *_: context)
    seen, generated = [], []

    def classify(messages, info):
        seen.append(messages[-1].parts[-1].content)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})], model_name="jev-1.13.0",
            provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}})

    def generate(messages, info):
        generated.append(messages[-1].parts[-1].content)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"nothing_fits": True, "entries": []})], model_name="test-writer")

    async def retrieve(*_):
        return None, None

    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")
    monkeypatch.setattr("tailoring.prepare_resume_draft.retrieve_source_keys_async", retrieve)
    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(classify, model_name="jev-1.13.0"))
    offline_model_resolution("openai:test-writer", FunctionModel(generate, model_name="test-writer"))

    async def run():
        with contact_scope(contact):
            with screening_session() as session:
                prepared = await prepare_resume_draft(uuid4(), uuid4(), dependencies,
                    usage=[], warnings=[], gap_responses=[snapshot])
                requests = [text for text in seen if "Unicode gap requirement" in text]
                assert len(requests) == 1
                assert "«name» built services" in requests[0]
                assert all(name not in text and escaped_name not in text for text in seen)
                prompt = prepared.prompts["summary"]
                assert f"Unicode gap requirement: {name} built services" in prompt.text
                assert prompt_is_covered(prompt.text)
                assert any(report.record_id == row["id"] for report in session.screening_successes)
                screened_count = len(seen)
                await write_resume_section_async(prompt, "openai:test-writer", "low", 20, "openai:test-writer")
                assert len(seen) == screened_count
                assert "«name» built services" in generated[0]
                assert name not in generated[0] and escaped_name not in generated[0]
            snapshot.update(screened_at=now.isoformat(),
                       screening_policy_version=screening_policy_version(dependencies.settings.user_text_screen_model))
            before = len(seen)
            with screening_session():
                prepared = await prepare_resume_draft(uuid4(), uuid4(), dependencies,
                    usage=[], warnings=[], gap_responses=[snapshot])
                assert prompt_is_covered(prepared.prompts["summary"].text)
                assert f"Unicode gap requirement: {name} built services" in prepared.prompts["summary"].text
            assert not any("Unicode gap requirement" in text for text in seen[before:])
    asyncio.run(run())
