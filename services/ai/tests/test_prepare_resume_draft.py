"""Prepare one draft through real screening policy and controlled provider boundaries."""

import asyncio
from collections import Counter
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai.usage import RunUsage

from agents.user_text_screen_agent import UserTextScreenRun
from schemas.user_text_screen import UserTextScreen
from screening.session import prompt_is_covered, screening_session
from tests.fakes import build_gap_analysis_context


def allowed_run(text):
    return UserTextScreenRun(UserTextScreen(prompt_injection="attack" in text, harmful_request=False),
        "jev-1.13.0", {"prompt_injection": 1., "harmful_request": 1.}, RunUsage(input_tokens=7))


def library_reports(session):
    return [report for report in session.record_screening
            if report.record_type not in {"job", "gap_response"}]


def gap_reports(session):
    return [report for report in session.record_screening if report.record_type == "gap_response"]


def job_reports(session):
    return [report for report in session.record_screening if report.record_type == "job"]


@pytest.fixture
def preparation(task_dependencies, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")
    context = build_gap_analysis_context()
    reads = []
    calls = []
    user_id, job_id = uuid4(), uuid4()

    def read(user, job):
        reads.append((user, job))
        return context

    async def classify(text, model, timeout):
        calls.append(text)
        return allowed_run(text)

    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", classify)
    return replace(task_dependencies, read_gap_analysis_context=read), context, reads, calls, user_id, job_id


def test_shared_evidence_once_exact_prompts_and_fresh_execution(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, reads, calls, user, job = preparation

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


def test_completed_gap_analysis_includes_every_assessment_without_rescreening(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, calls, user, job = preparation
    analysis = {
        "summary": "Strong match with one gap.",
        "assessments": [
            {"kind": "required", "requirement": "Build Python APIs", "verdict": "met",
             "explanation": "The candidate has done this.",
             "evidence": [{"kind": "highlight", "id": "highlight-1", "text": "Built Python APIs"}]},
            {"kind": "nice_to_have", "requirement": "Use a cloud platform", "verdict": "partial",
             "explanation": "Production deployment is documented, but the provider is unclear.",
             "evidence": []},
        ],
    }

    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies,
                usage=[], warnings=[], gap_analysis=analysis)
            prompt = prepared.prompts["experience"].text
            assert "Strong match with one gap." in prompt
            assert "Build Python APIs" in prompt
            assert "The candidate has done this." in prompt
            assert "Evidence (highlight): Built Python APIs" in prompt
            assert "Use a cloud platform" in prompt
            assert "Production deployment is documented" in prompt
            assert prompt_is_covered(prompt)
        assert all("Strong match with one gap." not in text for text in calls)
        assert all("The candidate has done this." not in text for text in calls)

    asyncio.run(run())


def test_user_gap_responses_are_screened_together(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, calls, user, job = preparation
    responses = [
        {"requirement": "Python", "body": "Built backend services."},
        {"requirement": "AWS", "body": "Deployed production workloads."},
    ]

    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies,
                usage=[], warnings=[], gap_responses=responses)
            assert "[GR1]" in prepared.prompts["experience"].text
            assert "[GR2]" in prepared.prompts["experience"].text
            assert prompt_is_covered(prepared.prompts["experience"].text)
        grouped = [text for text in calls if "Built backend services." in text or
                   "Deployed production workloads." in text]
        assert len(grouped) == 1
        assert "Built backend services." in grouped[0]
        assert "Deployed production workloads." in grouped[0]

    asyncio.run(run())


@pytest.mark.parametrize("source", ["job", "library"])
def test_rejected_shared_batch_stops_required_work_without_partial_approvals(preparation, source):
    from tailoring.prepare_resume_draft import ResumePreparationError, prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    if source == "job":
        context.job.title = "attack"
    else:
        context.career_library.skills[0].name = "attack"
    async def run():
        with screening_session() as session, pytest.raises(ResumePreparationError):
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
        assert not session.record_screening
        assert len(calls) == 1
    asyncio.run(run())


def test_single_batch_cancellation_is_awaited_and_writes_no_receipts(preparation, monkeypatch):
    from tailoring.prepare_resume_draft import prepare_resume_draft
    dependencies, _, _, _, user, job = preparation
    async def run():
        started, stopped = asyncio.Event(), asyncio.Event()
        async def classify(text, model, timeout):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
        monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", classify)
        with screening_session() as session:
            task = asyncio.create_task(prepare_resume_draft(user, job, dependencies, usage=[], warnings=[]))
            await asyncio.wait_for(started.wait(), 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert stopped.is_set()
            assert not session.record_screening
    asyncio.run(run())


def test_summary_uses_selected_stable_labels_and_rejects_later_execution(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, _, user, job = preparation

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
    from llm.usage import collect_task_usage, current_task_usage
    from privacy.contact_mask import contact_scope, current_known_contact
    from privacy.known_contact import KnownContact
    from tailoring.prepare_resume_draft import prepare_resume_draft
    from worker.queue_messages import AiTaskMessage

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

    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")
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


def test_summary_selected_labels_filter_the_full_library(preparation):
    """The summary keeps selected evidence without embedding a search query."""
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, _, user, job = preparation

    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert "S2" in prepared.prompts["summary"].sources.records
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

    from llm.usage import collect_task_usage
    from tailoring.prepare_resume_draft import prepare_resume_draft

    context = build_gap_analysis_context()
    dependencies = replace(task_dependencies, read_gap_analysis_context=lambda *_: context)
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")


    async def run():
        started = asyncio.Event()
        blocked = asyncio.Event()
        active = 0
        stopped = []

        async def classify(messages, info):
            nonlocal active
            text = messages[-1].parts[-1].content
            if text:
                active += 1
                if active == 1:
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
            assert len(stopped) == 1
            assert sum(item.input_tokens for item in usage) == 0
            assert sum(item.input_tokens for item in accounting.entries) == 0
            assert accounting.incomplete
    asyncio.run(run())


def test_saved_field_checks_reused_and_only_consumed_fields_reported(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    library = context.career_library
    library.summary_record_id = str(user)
    library.projects[0].role = "unused project role"
    library.projects[0].description = "A saved project description"
    library.skills[0].category = "unused category"
    library.educations[0].description = "education description"

    async def run():
        with screening_session() as session:
            first = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            reports = list(library_reports(session))
            assert reports
            assert all(prompt_is_covered(prompt.text) for prompt in first.prompts.values())
        assert sum("Company:\n" in text for text in calls) == len(library.experiences)
        records = {("user", str(user)): library}
        for collection, kind in (("experiences", "experience"), ("projects", "project"),
                                 ("educations", "education"), ("certifications", "certification"),
                                 ("skills", "skill"), ("career_contexts", "career_context")):
            records.update({(kind, row.id): row for row in getattr(library, collection)})
        for experience in library.experiences:
            records.update({("experience_highlight", row.id): row for row in experience.highlights})
        for report in reports:
            record = records[report.record_type, str(report.record_id)]
            record.screened_fields = list(set(record.screened_fields) | set(report.fingerprints))
        assert "role" not in library.projects[0].screened_fields
        assert "category" not in library.skills[0].screened_fields
        assert "description" in library.educations[0].screened_fields
        calls.clear()
        with screening_session() as session:
            second = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert not library_reports(session)
            assert all(prompt_is_covered(prompt.text) for prompt in second.prompts.values())
            assert all("screened_fields" not in prompt.text for prompt in second.prompts.values())
        assert len(calls) == 1 and "Requirements:" in calls[0]
        library.projects[0].screened_fields.remove("description")
        calls.clear()
        with screening_session() as session:
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert any(report.record_type == "project" and set(report.fingerprints) == {"description"}
                       for report in library_reports(session))
        assert len(calls) == 1
        assert "Description" in calls[-1] and "unused project role" not in calls[-1]
    asyncio.run(run())


def test_approved_oversized_library_still_fails_before_screening(preparation):
    """A previous field approval never exempts saved text from the aggregate cap."""
    from tailoring.prepare_resume_draft import ResumePreparationError, prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    project = context.career_library.projects[0]
    project.name = "x" * 81_000
    project.screened_fields = ["name", "description"]
    warnings = []

    async def run():
        with screening_session() as session:
            with pytest.raises(ResumePreparationError, match="career library is too long"):
                await prepare_resume_draft(user, job, dependencies, usage=[], warnings=warnings)
            assert not library_reports(session)
        assert calls == []
        assert warnings == []
    asyncio.run(run())


def test_every_saved_evidence_kind_screens_only_rendered_text(preparation):
    """Fields absent from evidence cannot gain approvals; structured dates stay structured."""
    from schemas.gap_analysis_context import CareerLibrary
    from tailoring.labeled_sources import label_sources
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    ids = {kind: str(uuid4()) for kind in (
        "experience", "highlight", "project", "education", "certification", "skill", "career_context")}
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
                        "description": "School description"}],
        "certifications": [{
            "id": ids["certification"], "name": "Credential evidence", "issuer": "Issuer evidence",
            "credential_id": "Credential identifier", "credential_url": "https://credential.example",
            "description": "Credential description", "issued_date": "2020-01-01",
            "issued_date_precision": "year", "expiry_date": "2030-02-01",
            "expiry_date_precision": "month",
        }],
        "skills": [{"id": ids["skill"], "name": "Skill evidence", "category": "Omitted category"}],
        "career_contexts": [{"id": ids["career_context"], "requirement": "Fact requirement", "response": "Fact evidence"}],
    })
    expected = {
        ("user", str(user)): {"summary": "Profile evidence"},
        ("experience", ids["experience"]): {
            "title": "Role evidence", "company": "Employer evidence", "description": "Role description"},
        ("experience_highlight", ids["highlight"]): {"content": "Highlight evidence"},
        ("project", ids["project"]): {"name": "Project evidence", "description": "Project description"},
        ("education", ids["education"]): {
            "institution": "School evidence", "degree": "Degree evidence",
            "field_of_study": "Subject evidence", "description": "School description"},
        ("certification", ids["certification"]): {
            "name": "Credential evidence", "issuer": "Issuer evidence", "credential_id": "Credential identifier",
            "credential_url": "https://credential.example", "description": "Credential description"},
        ("skill", ids["skill"]): {"name": "Skill evidence"},
        ("career_context", ids["career_context"]): {"requirement": "Fact requirement", "response": "Fact evidence"},
    }
    sources = label_sources(context, [], [])
    assert sources.records["C1"].text == (
        "Credential evidence, Issuer evidence, issued 2020, expires 2030-02, "
        "Credential identifier, https://credential.example, Credential description")
    # The public source interface exposes provenance for every saved kind.
    assert {record.kind for record in sources.records.values() if record.provenance} == {
        "summary", "experience", "highlight", "project", "education", "certification", "skill", "career_context"}

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            reports = {(report.record_type, str(report.record_id)): set(report.fingerprints)
                       for report in library_reports(session)}
            assert reports == {identity: set(values) for identity, values in expected.items()}
            assert all(prompt_is_covered(prompt.text) for prompt in prepared.prompts.values())
            assert all("screened_fields" not in prompt.text and "provenance" not in prompt.text
                       for prompt in prepared.prompts.values())
        pending = "\n\n".join(calls)
        assert pending.count("Entry ") == len(expected) + 1
        for values in expected.values():
            for field, value in values.items():
                assert pending.count(f"{field.replace('_', ' ').capitalize()}:\n{value}") == 1
        rendered = sources.text_for(list(sources.records))
        assert all(value in rendered for values in expected.values() for value in values.values())
        assert "Omitted" not in rendered
        assert all("Omitted" not in text for text in calls)
    asyncio.run(run())


def test_highlights_reuse_partial_saved_parent_checks(preparation):
    """Role identity screens once and highlights screen only their unchecked content."""
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    role = context.career_library.experiences[0]
    role.screened_fields = ["title"]
    role.description = "Unsaved role description"

    async def run():
        with screening_session() as session:
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            role_reports = [report for report in library_reports(session)
                            if report.record_type == "experience" and str(report.record_id) == role.id]
            assert len(role_reports) == 1
            assert set(role_reports[0].fingerprints) == {"company", "description"}
            for highlight in role.highlights:
                reports = [report for report in library_reports(session)
                           if report.record_type == "experience_highlight"
                           and str(report.record_id) == highlight.id]
                assert len(reports) == 1
                assert set(reports[0].fingerprints) == {"content"}
        pending = "\n\n".join(calls)
        assert f"Title:\n{role.title}" not in pending
        assert pending.count(f"Company:\n{role.company}") == 1
    asyncio.run(run())


def test_identical_saved_skills_keep_each_identity_and_reuse_field_checks(preparation):
    """Sharing classification must not drop one saved row or approve its hidden fields."""
    from schemas.gap_analysis_context import LibrarySkill
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    skills = [LibrarySkill(id=str(uuid4()), name="Shared skill", category="Unused category")
              for _ in range(2)]
    context.career_library.skills = skills

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            reports = [report for report in library_reports(session) if report.record_type == "skill"]
            assert {(str(report.record_id), tuple(report.fingerprints)) for report in reports} == {
                (skill.id, ("name",)) for skill in skills}
            assert {"S1", "S2"} <= prepared.prompts["skills"].sources.records.keys()
            assert prompt_is_covered(prepared.prompts["skills"].text)
        assert sum("Name:\nShared skill" in text for text in calls) == 1
        assert all("Unused category" not in text for text in calls)

        for skill in skills:
            skill.screened_fields = ["name"]
        calls.clear()
        with screening_session() as session:
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert not [report for report in library_reports(session) if report.record_type == "skill"]
        assert all("Shared skill" not in text for text in calls)

    asyncio.run(run())


def test_equal_rendered_sources_check_each_kinds_actual_used_fields(preparation):
    """One checked rendered value cannot approve another record's different field split."""
    from schemas.gap_analysis_context import (
        CareerContext,
        CareerLibrary,
        LibraryProject,
        LibrarySkill,
    )
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    shared = "Shared: detail"
    context.career_library = CareerLibrary(
        summary=shared, summary_record_id=str(user),
        projects=[
            LibraryProject(id="approved-project", name=shared, screened_fields=["name"]),
            LibraryProject(id="split-project", name="Shared", description="detail", role="Unused role"),
        ],
        skills=[LibrarySkill(id="skill", name=shared, screened_fields=["name"], category="Unused category")],
        career_contexts=[CareerContext(id="career_context", requirement="Shared", response="detail")],
    )

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert {(report.record_type, str(report.record_id), tuple(report.fingerprints))
                    for report in library_reports(session)} == {
                        ("user", str(user), ("summary",)),
                        ("project", "split-project", ("name", "description")),
                        ("career_context", "career_context", ("requirement", "response")),
                    }
            summary = await prepared.summary_prompt([])
            assert {"SUMMARY", "P1", "P2", "S1", "F1"} == summary.sources.records.keys()
            assert prompt_is_covered(summary.text)
        assert sum(f"Summary:\n{shared}" in text for text in calls) == 1
        assert sum("Name:\nShared\n\nDescription:\ndetail" in text for text in calls) == 1
        assert sum("Requirement:\nShared\n\nResponse:\ndetail" in text for text in calls) == 1
        assert all("Unused" not in text for text in calls)

    asyncio.run(run())


def test_summary_records_new_saved_id_even_when_its_text_was_already_screened(preparation):
    """A later summary snapshot must retain all provenance behind an earlier decision."""
    from schemas.gap_analysis_context import LibrarySkill
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    context.career_library.skills = [LibrarySkill(id="first-skill", name="Shared skill")]

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            first_call_count = len(calls)
            context.career_library.skills.append(LibrarySkill(id="later-skill", name="Shared skill"))
            summary = await prepared.summary_prompt([], selected_labels={"S1", "S2"})
            assert set(summary.sources.records) == {"S1", "S2"}
            assert prompt_is_covered(summary.text)
            assert {(str(report.record_id), tuple(report.fingerprints)) for report in library_reports(session)
                    if report.record_type == "skill"} == {
                        ("first-skill", ("name",)), ("later-skill", ("name",))}
            assert len(calls) == first_call_count + 1

    asyncio.run(run())


@pytest.mark.parametrize("approved_first", [True, False])
@pytest.mark.parametrize("failure", ["blocked", "unavailable"])
def test_checked_text_collision_cannot_hide_rejected_saved_fields(preparation, monkeypatch, approved_first, failure):
    """Previously checked generated text never substitutes for checking a new field."""
    from schemas.gap_analysis_context import CareerLibrary, LibrarySkill
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    approved = LibrarySkill(id="approved-skill", name="attack", screened_fields=["name"])
    unchecked = LibrarySkill(id="unchecked-skill", name="attack")
    context.career_library = CareerLibrary(skills=[approved, unchecked] if approved_first else [unchecked, approved])
    if failure == "unavailable":
        monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", dependencies.settings.user_text_screen_model)

        async def unavailable_for_skill(text, model, timeout):
            calls.append(text)
            if "Name:\nattack" in text:
                raise RuntimeError("Synthetic screening outage")
            return allowed_run(text)

        monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", unavailable_for_skill)

    async def run():
        from tailoring.prepare_resume_draft import ResumePreparationError
        with screening_session() as session, pytest.raises(ResumePreparationError):
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
        assert not session.record_screening
        assert sum("Name:\nattack" in text for text in calls) == 1

    asyncio.run(run())


def test_tailoring_reuses_job_checks_from_gap_analysis_and_checks_only_edited_list(preparation):
    from datetime import date

    from agents.user_text_screen_agent import user_text_screen_agent
    from gap_analysis.prepare_gap_analysis import prepare_gap_analysis
    from tailoring.prepare_resume_draft import prepare_resume_draft
    from tests.test_gap_context_screening import jev_model

    dependencies, context, _, calls, user, job = preparation
    with screening_session() as session, user_text_screen_agent.override(model=jev_model([])):
        assert prepare_gap_analysis(context, today=date(2026, 10, 25),
            screen_model="typesafe:jev-1.13.0", timeout_seconds=5).prompt is not None
        context.job.screened_fields = list(next(
            receipt for receipt in session.record_screening if receipt.record_type == "job").fingerprints)

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert all(prompt_is_covered(prompt.text) for prompt in prepared.prompts.values())
            assert not job_reports(session)
            assert all("Job title:" not in text for text in calls)
        context.job.requirements = ["Changed requirement"]
        context.job.screened_fields.remove("requirements")
        calls.clear()
        with screening_session() as session:
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
            assert set(job_reports(session)[0].fingerprints) == {"requirements"}
        assert "Requirements:\nChanged requirement" in calls[0]

    asyncio.run(run())


def test_approved_job_still_obeys_complete_source_limit(preparation):
    from tailoring.prepare_resume_draft import ResumePreparationError, prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    context.job.title = "x" * 80_001
    context.job.screened_fields = ["title", "company", "requirements", "nice_to_haves"]

    async def run():
        with screening_session() as session, pytest.raises(ResumePreparationError):
            await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[])
        assert not job_reports(session)
        assert not calls

    asyncio.run(run())


def test_saved_gap_response_fields_reused_without_screening(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, calls, user, job = preparation
    responses = [{"id": str(uuid4()), "requirement": "Unique requirement",
                  "body": "Unique saved answer", "screened_fields": ["requirement", "body"]}]

    async def run():
        with screening_session():
            prepared = await prepare_resume_draft(user, job, dependencies,
                usage=[], warnings=[], gap_responses=responses)
            assert "Unique saved answer" in prepared.prompts["experience"].text
            assert prompt_is_covered(prepared.prompts["experience"].text)
        assert not any("Unique saved answer" in text or "Unique requirement" in text for text in calls)

    asyncio.run(run())


@pytest.mark.parametrize("approved_first", [False, True])
def test_grouped_gap_checks_keep_every_identity_and_field_split(preparation, approved_first):
    from screening.records import field_fingerprint
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, calls, user, job = preparation
    ids = [str(uuid4()) for _ in range(3)]
    responses = [
        {"id": ids[0], "requirement": "A: B", "body": "C"},
        {"id": ids[1], "requirement": "A", "body": "B: C"},
        {"id": ids[2], "requirement": "A: B", "body": "C",
         "screened_fields": ["requirement", "body"]},
    ]
    if approved_first:
        responses.reverse()

    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies,
                usage=[], warnings=[], gap_responses=responses)
            reports = {report.record_id: report.fingerprints for report in gap_reports(session)}
            assert reports == {ids[0]: {"requirement": field_fingerprint("A: B"), "body": field_fingerprint("C")},
                               ids[1]: {"requirement": field_fingerprint("A"), "body": field_fingerprint("B: C")}}
            assert all(prompt_is_covered(prompt.text) for prompt in prepared.prompts.values())
            assert "screened_fields" not in prepared.prompts["experience"].text
            assert not any(id in prepared.prompts["experience"].text for id in ids)
            count = len(calls)
            await prepared.summary_prompt([], selected_labels={"GR1", "GR2", "GR3"})
            assert len(calls) == count
        assert len([text for text in calls if "Body:" in text]) == 1
    asyncio.run(run())


def test_gap_partial_approval_and_legacy_summary_subset_reuse(preparation):
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, _, _, calls, user, job = preparation
    response_id = str(uuid4())
    responses = [
        {"id": response_id, "requirement": "Already approved", "body": "Fresh answer",
         "screened_fields": ["requirement"]},
        {"requirement": "Legacy requirement", "body": "Legacy answer", "screened_fields": ["requirement", "body"]},
    ]
    async def run():
        with screening_session() as session:
            prepared = await prepare_resume_draft(user, job, dependencies,
                usage=[], warnings=[], gap_responses=responses)
            assert [set(report.fingerprints) for report in gap_reports(session)] == [{"body"}]
            count = len(calls)
            await prepared.summary_prompt([], selected_labels={"GR2"})
            assert len(calls) == count
        grouped = [text for text in calls if "Body:" in text]
        assert len(grouped) == 1
        assert "Already approved" not in grouped[0]
        assert "Fresh answer" in grouped[0] and "Legacy answer" in grouped[0]
    asyncio.run(run())


@pytest.mark.parametrize("blocked", [False, True])
def test_gap_library_text_collision_preserves_each_provenance(preparation, blocked):
    from schemas.gap_analysis_context import CareerContext
    from tailoring.prepare_resume_draft import prepare_resume_draft

    dependencies, context, _, calls, user, job = preparation
    context.career_library.career_contexts = [CareerContext(id="fact-collision", requirement="Equal requirement",
        response="attack" if blocked else "Equal answer", screened_fields=["requirement", "response"])]
    responses = [{"id": str(uuid4()), "requirement": "Equal requirement",
                  "body": "attack" if blocked else "Equal answer"}]
    async def run():
        from tailoring.prepare_resume_draft import ResumePreparationError
        with screening_session() as session:
            if blocked:
                with pytest.raises(ResumePreparationError):
                    await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[], gap_responses=responses)
                assert not session.record_screening
            else:
                prepared = await prepare_resume_draft(user, job, dependencies, usage=[], warnings=[], gap_responses=responses)
                assert gap_reports(session)
                assert "[GR1]" in prepared.prompts["experience"].text
                assert prompt_is_covered(prepared.prompts["experience"].text)
        assert len(calls) == 1

    asyncio.run(run())


def test_summary_inclusion_snapshot_does_not_change_generation_contract():
    """Formatting preferences stay in Rails while the writer still produces reusable text."""
    from tailoring.tailor_resume_input import TailorResumeInput

    value = TailorResumeInput.model_validate({"job_id": "11111111-1111-1111-1111-111111111111", "include_summary": False})
    assert str(value.job_id) == "11111111-1111-1111-1111-111111111111"
    assert value.contact == {}
