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
from tailoring.build_section_prompt import job_context_text
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
        assert job_context_text(context) in current_session().allowed_sources
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
            if text.startswith("# Job:"):
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
            if not text.startswith("# Job:"):
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


def test_saved_field_checks_reused_and_only_consumed_fields_reported(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation
    library = context.career_library
    library.summary_record_id = str(user)
    library.projects[0].role = "unused project role"
    library.projects[0].description = "A saved project description"
    library.skills[0].category = "unused category"
    library.educations[0].description = "unused education description"

    async def run():
        with screening_session() as session:
            first = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            reports = list(session.library_screening)
            assert reports
            assert all(prompt_is_covered(prompt.text) for prompt in first.prompts.values())
        assert sum("company:\n" in text for text in calls) == len(library.experiences)
        records = {("user", str(user)): library}
        for collection, kind in (("experiences", "experience"), ("projects", "project"),
                                 ("educations", "education"), ("certifications", "certification"),
                                 ("skills", "skill"), ("facts", "library_fact")):
            records.update({(kind, row.id): row for row in getattr(library, collection)})
        for experience in library.experiences:
            records.update({("experience_highlight", row.id): row for row in experience.highlights})
        for report in reports:
            record = records[report.record_type, str(report.record_id)]
            record.screened_fields = list(set(record.screened_fields) | set(report.fields))
        assert "role" not in library.projects[0].screened_fields
        assert "category" not in library.skills[0].screened_fields
        assert "description" not in library.educations[0].screened_fields
        calls.clear()
        with screening_session() as session:
            second = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert not session.library_screening
            assert all(prompt_is_covered(prompt.text) for prompt in second.prompts.values())
            assert all("screened_fields" not in prompt.text for prompt in second.prompts.values())
        assert calls == [job_context_text(context)]
        library.projects[0].screened_fields.remove("description")
        calls.clear()
        with screening_session() as session:
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert any(report.record_type == "project" and report.fields == ["description"]
                       for report in session.library_screening)
        assert len(calls) == 2
        assert "description" in calls[-1] and "unused project role" not in calls[-1]
    asyncio.run(run())


def test_approved_oversized_and_rejected_library_sources_stay_out(preparation, monkeypatch):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation
    project = context.career_library.projects[0]
    project.name = "x" * 81_000
    project.screened_fields = ["name", "description"]
    context.career_library.skills[0].name = "attack"
    warnings = []

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=warnings)
            assert all("P1" not in prompt.sources.records and "S1" not in prompt.sources.records
                       for prompt in prepared.prompts.values())
            assert not any(report.record_type == "project" and report.record_id == project.id
                           for report in session.library_screening)
            assert not any(report.record_type == "skill" and report.record_id == context.career_library.skills[0].id
                           for report in session.library_screening)
        assert all(project.name not in text for text in calls)
        assert "One of your notes was left out because it is too long." in warnings
        assert "One of your notes was left out." in warnings
    asyncio.run(run())


def test_every_saved_evidence_kind_screens_only_rendered_text(preparation):
    """Fields absent from evidence cannot gain approvals; structured dates stay structured."""
    from schemas.gap_analysis_context import CareerLibrary
    from tailoring.labeled_sources import label_sources
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation
    ids = {kind: str(uuid4()) for kind in (
        "experience", "highlight", "project", "education", "certification", "skill", "fact")}
    context.career_library = CareerLibrary.model_validate({
        "summary_record_id": str(user), "summary": "Profile evidence",
        "experiences": [{
            "id": ids["experience"], "title": "Role evidence", "company": "Employer evidence",
            "description": "Role description", "location": "Omitted location",
            "highlights": [{"id": ids["highlight"], "content": "Highlight evidence"}],
        }],
        "projects": [{"id": ids["project"], "name": "Project evidence",
                      "description": "Project description", "role": "Omitted project role"}],
        "educations": [{"id": ids["education"], "institution": "School evidence",
                        "degree": "Degree evidence", "field_of_study": "Subject evidence",
                        "description": "Omitted school description"}],
        "certifications": [{
            "id": ids["certification"], "name": "Credential evidence", "issuer": "Issuer evidence",
            "credential_id": "Credential identifier", "credential_url": "https://credential.example",
            "description": "Credential description", "issued_date": "2020-01-01",
            "issued_date_precision": "year", "expiry_date": "2030-02-01",
            "expiry_date_precision": "month",
        }],
        "skills": [{"id": ids["skill"], "name": "Skill evidence", "category": "Omitted category"}],
        "facts": [{"id": ids["fact"], "requirement": "Fact requirement", "response": "Fact evidence"}],
    })
    expected = {
        ("user", str(user)): {"summary": "Profile evidence"},
        ("experience", ids["experience"]): {
            "title": "Role evidence", "company": "Employer evidence", "description": "Role description"},
        ("experience_highlight", ids["highlight"]): {"content": "Highlight evidence"},
        ("project", ids["project"]): {"name": "Project evidence", "description": "Project description"},
        ("education", ids["education"]): {
            "institution": "School evidence", "degree": "Degree evidence", "field_of_study": "Subject evidence"},
        ("certification", ids["certification"]): {
            "name": "Credential evidence", "issuer": "Issuer evidence", "credential_id": "Credential identifier",
            "credential_url": "https://credential.example", "description": "Credential description"},
        ("skill", ids["skill"]): {"name": "Skill evidence"},
        ("library_fact", ids["fact"]): {"requirement": "Fact requirement", "response": "Fact evidence"},
    }
    sources = label_sources(context, [], [], None)
    assert sources.records["C1"].text == (
        "Credential evidence, Issuer evidence, issued 2020, expires 2030-02, "
        "Credential identifier, https://credential.example, Credential description")
    # The public source interface exposes provenance for every saved kind.
    assert {record.kind for record in sources.records.values() if record.provenance} == {
        "summary", "experience", "highlight", "project", "education", "certification", "skill", "fact"}

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            reports = {(report.record_type, str(report.record_id)): set(report.fields)
                       for report in session.library_screening}
            assert reports == {identity: set(values) for identity, values in expected.items()}
            assert all(prompt_is_covered(prompt.text) for prompt in prepared.prompts.values())
            assert all("screened_fields" not in prompt.text and "provenance" not in prompt.text
                       for prompt in prepared.prompts.values())
        pending = "\n\n".join(calls[1:])
        assert pending.count("Entry ") == len(expected)
        for values in expected.values():
            for field, value in values.items():
                assert pending.count(f"{field}:\n{value}") == 1
        rendered = sources.text_for(list(sources.records))
        assert all(value in rendered for values in expected.values() for value in values.values())
        assert "Omitted" not in rendered
        assert all("Omitted" not in text for text in calls)
    asyncio.run(run())


def test_highlights_reuse_partial_saved_parent_checks(preparation):
    """Role identity screens once and highlights screen only their unchecked content."""
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, _, user, job = preparation
    role = context.career_library.experiences[0]
    role.screened_fields = ["title"]
    role.description = "Unsaved role description"

    async def run():
        with screening_session() as session:
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            role_reports = [report for report in session.library_screening
                            if report.record_type == "experience" and str(report.record_id) == role.id]
            assert len(role_reports) == 1
            assert set(role_reports[0].fields) == {"company", "description"}
            for highlight in role.highlights:
                reports = [report for report in session.library_screening
                           if report.record_type == "experience_highlight"
                           and str(report.record_id) == highlight.id]
                assert len(reports) == 1
                assert reports[0].fields == ["content"]
        pending = "\n\n".join(calls[1:])
        assert f"title:\n{role.title}" not in pending
        assert pending.count(f"company:\n{role.company}") == 1
    asyncio.run(run())
