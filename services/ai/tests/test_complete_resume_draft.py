"""Exercise complete resume generation through the queued-task handler.

Synthetic providers keep prompt, screening, validation, and assembly behavior in play.
No test contacts an external service or writes domain data.
"""

import asyncio
from dataclasses import replace
from datetime import date
from uuid import uuid4

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RunUsage

from agents.resume_tailoring_agent import resume_tailoring_agent
from agents.user_text_screen_agent import UserTextScreenRun
from schemas.gap_analysis_context import CareerLibrary, LibraryCertification
from schemas.user_text_screen import UserTextScreen
from tests.fakes import build_gap_analysis_context
from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def task_input(**extra):
    return {"job_id": str(uuid4()),
        "contact": {"full_name": "Synthetic Candidate", "email": "candidate@example.com", "links": []},
        **extra}


def task(data=None):
    return AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="tailor_resume", input=data or task_input())


def section_name(messages):
    text = next(part.content for message in messages for part in message.parts if part.part_kind == "user-prompt")
    return text.split("# Write the ", 1)[1].split(" section", 1)[0].lower()


def answer(info, output):
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)],
        model_name="openai:gpt-5-mini", usage=RunUsage(input_tokens=11, output_tokens=5))


def selected_output(section):
    if section == "summary":
        return {"nothing_fits": False, "entries": [],
            "summary": {"text": "Engineer who built Python APIs.", "source_labels": ["H1"]}}
    labels = {"experience": "E1", "projects": "P1", "skills": "S1"}
    prose = [{"text": "Built Python APIs.", "source_labels": ["H1"]}] if section == "experience" else []
    return {"nothing_fits": False, "entries": [{"label": labels[section], "prose": prose}]}


@pytest.fixture
def generation(task_dependencies, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test")
    context = build_gap_analysis_context()
    seen = []

    async def classify(*_):
        return UserTextScreenRun(UserTextScreen(prompt_injection=False, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1., "harmful_request": 1.}, RunUsage(input_tokens=7))

    async def generate(messages, info):
        section = section_name(messages)
        seen.append((section, messages[-1].parts[-1].content))
        return answer(info, selected_output(section))

    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", classify)
    dependencies = replace(task_dependencies, read_gap_analysis_context=lambda *_: context)
    return dependencies, context, seen, FunctionModel(generate, model_name="gpt-5-mini")


def test_one_task_returns_complete_draft_without_query_embeddings(generation, monkeypatch):
    dependencies, _, seen, model = generation
    monkeypatch.setattr("memory.embed_search_query.embed_search_query_async",
        lambda *_: pytest.fail("Tailoring already has the library and must not embed search queries"))
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "completed"
    assert "generation" not in result.model_dump()
    assert result.pending_questions == []
    sections = result.result["sections"]
    assert [section["section_type"] for section in sections] == [
        "contact", "summary", "experience", "projects", "education", "skills"]
    assert sections[0]["content"]["full_name"] == "Synthetic Candidate"
    assert sections[1]["content"]["text"] == "Engineer who built Python APIs."
    assert sections[2]["content"]["items"][0]["highlights"] == ["Built Python APIs."]
    assert {name for name, _ in seen} == {"experience", "projects", "skills", "summary"}
    assert seen[-1][0] == "summary"
    assert "[A1]" not in seen[-1][1]
    assert "[SUMMARY] Backend engineer." in seen[-1][1]
    assert "# Sources" in seen[-1][1]
    assert "Synthetic Candidate" not in seen[-1][1]


def test_novel_prose_finishes_on_first_response_and_keeps_saved_role_identity(generation, offline_model_resolution):
    dependencies, context, seen, _ = generation
    novel_bullet = "Improved the Orion API by 37% for Aurora Labs."

    async def generate(messages, info):
        section = section_name(messages)
        seen.append(section)
        output = selected_output(section)
        if section == "experience":
            output["entries"][0]["prose"] = [{"text": novel_bullet, "source_labels": []}]
        if section == "summary":
            output["summary"]["source_labels"] = ["E1"]
        return answer(info, output)

    model = FunctionModel(generate, model_name="gpt-5-mini")
    offline_model_resolution(dependencies.settings.resume_tailoring_model, model)
    offline_model_resolution(dependencies.settings.generative_fallback_model, model)
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)

    assert result.status == "completed"
    assert seen.count("experience") == 1
    role = next(section for section in result.result["sections"] if section["section_type"] == "experience")["content"]["items"][0]
    saved_role = context.career_library.experiences[0]
    assert role["highlights"] == [novel_bullet]
    assert (role["company"], role["title"], role["start_date"]) == (
        saved_role.company, saved_role.title, saved_role.start_date.strftime("%Y-%m"))


def test_unknown_entry_label_gets_one_repair_then_completes(generation, offline_model_resolution):
    dependencies, _, seen, _ = generation

    async def generate(messages, info):
        section = section_name(messages)
        seen.append(section)
        output = selected_output(section)
        if section == "experience" and seen.count("experience") == 1:
            output["entries"][0]["label"] = "E99"
        return answer(info, output)

    model = FunctionModel(generate, model_name="gpt-5-mini")
    offline_model_resolution(dependencies.settings.resume_tailoring_model, model)
    offline_model_resolution(dependencies.settings.generative_fallback_model, model)
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)

    assert result.status == "completed"
    assert seen.count("experience") == 2
    assert len(result.result["sections"]) == 6


@pytest.mark.real_guardrail
@pytest.mark.parametrize("queued", [False, True])
def test_complete_draft_recovery_keeps_each_classifier_cost_once(
    generation, monkeypatch, offline_model_resolution, queued,
):
    """Shared async preparation recovers through Nano and reports its actual model price."""
    import json

    from pydantic_ai.exceptions import ModelHTTPError

    from agents.user_text_screen_agent import screen_user_message_async
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message

    dependencies, _, _, model = generation
    # Force multiple whole-record blobs to exercise recovery after a paid success.
    monkeypatch.setattr("screening.records.MAX_SCREENED_TEXT", 300)
    calls = {"jev": 0, "nano": 0}

    def jev(messages, info):
        calls["jev"] += 1
        if calls["jev"] > 1:
            raise ModelHTTPError(503, "jev-1.13.0", "unavailable")
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            model_name="jev-1.13.0", usage=RunUsage(input_tokens=7),
            provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}})

    def nano(messages, info):
        calls["nano"] += 1
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            model_name="openai:gpt-5-nano", usage=RunUsage(input_tokens=13, output_tokens=2))

    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", screen_user_message_async)
    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev, model_name="jev-1.13.0"))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(nano, model_name="openai:gpt-5-nano"))
    offline_model_resolution(dependencies.settings.resume_tailoring_model, model)
    message = task()
    if queued:
        queue = FakeResultQueue()
        assert process_task_message(message.model_dump_json(), 1, queue, dependencies)
        result = json.loads(queue.sent_bodies[-1])
        assert result["usage_incomplete"]  # Failed JEV requests have unknown usage.
    else:
        with resume_tailoring_agent.override(model=model):
            result = handle_ai_task(message, dependencies).model_dump()
    assert result["status"] == "completed", result
    assert len(result["result"]["sections"]) == 6
    usage = result["usage"]
    assert calls["nano"] >= 1
    assert len(usage) == 1 + calls["nano"] + 4
    assert sum(entry["input_tokens"] for entry in usage if entry["model"] == "jev-1.13.0") == 7
    assert sum(entry["input_tokens"] for entry in usage if entry["model"] == "openai:gpt-5-nano") == calls["nano"] * 13


def test_copied_credentials_keep_descriptions_and_stated_date_precision(generation):
    dependencies, context, seen, model = generation
    context.career_library.educations[0].description = "Completed a research thesis."
    context.career_library.certifications = [LibraryCertification(
        id="cert-1", name="Cloud credential", issuer="Training company",
        issued_date=date(2024, 1, 1), issued_date_precision="year",
        expiry_date=date(2025, 2, 1), expiry_date_precision="month",
        credential_id="CREDENTIAL-1", credential_url="https://example.com/credential",
        description="Completed practical training.")]
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)
    sections = {section["section_type"]: section["content"] for section in result.result["sections"]}
    assert sections["education"]["items"][0]["description"] == "Completed a research thesis."
    assert sections["certifications"]["items"] == [{
        "name": "Cloud credential", "issuer": "Training company", "issued_date": "2024",
        "expiry_date": "2025-02", "credential_id": "CREDENTIAL-1",
        "credential_url": "https://example.com/credential", "description": "Completed practical training."}]
    assert {name for name, _ in seen} == {"experience", "projects", "skills", "summary"}
    assert "Completed a research thesis." in seen[-1][1]
    assert "C1: expired" in seen[-1][1]


def test_sparse_credential_library_can_ground_the_summary(generation):
    dependencies, context, seen, _ = generation
    context.career_library = CareerLibrary(certifications=[LibraryCertification(id="cert-1", name="Cloud credential")])

    async def generate(messages, info):
        section = section_name(messages)
        seen.append((section, messages[-1].parts[-1].content))
        assert section == "summary"
        return answer(info, {"nothing_fits": False, "entries": [],
            "summary": {"text": "Earned a Cloud credential.", "source_labels": ["C1"]}})

    with resume_tailoring_agent.override(model=FunctionModel(generate)):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "completed"
    assert [section["section_type"] for section in result.result["sections"]] == ["contact", "summary", "certifications"]
    assert "[C1] Cloud credential" in seen[0][1]


def test_empty_library_skips_every_writer(generation):
    dependencies, context, seen, model = generation
    context.career_library = CareerLibrary()
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "completed"
    assert [section["section_type"] for section in result.result["sections"]] == ["contact"]
    assert result.result["warnings"] == []
    assert seen == []


def test_nothing_fits_omits_optional_writers_with_explanations(generation):
    dependencies, _, seen, _ = generation

    async def generate(messages, info):
        seen.append(section_name(messages))
        return answer(info, {"nothing_fits": True, "entries": []})

    with resume_tailoring_agent.override(model=FunctionModel(generate)):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "completed"
    assert [section["section_type"] for section in result.result["sections"]] == ["contact", "education"]
    assert len(result.result["warnings"]) == 4
    for section in ("Experience", "Projects", "Skills", "Summary"):
        assert any(section in warning and "omitted" in warning for warning in result.result["warnings"])
    assert result.pending_questions == []


def test_rejected_native_entries_skip_their_writer(generation, monkeypatch):
    dependencies, _, seen, _ = generation

    async def classify(text, *_):
        blocked = any(value in text for value in ("Now Co", "Deploy bot", "Python", "PostgreSQL")) and not text.startswith("Job title:")
        return UserTextScreenRun(UserTextScreen(prompt_injection=blocked, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1., "harmful_request": 1.}, RunUsage(input_tokens=7))

    async def generate(messages, info):
        section = section_name(messages)
        seen.append(section)
        assert section == "summary", "A rejected native entry must not reach its writer"
        return answer(info, {"nothing_fits": True, "entries": []})

    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", classify)
    with resume_tailoring_agent.override(model=FunctionModel(generate)):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert seen == []


@pytest.mark.real_guardrail
def test_independent_writers_overlap_and_keep_privacy_usage_and_transcript_context(
    generation, offline_model_resolution, monkeypatch, tmp_path,
):
    from conversation_logging import conversation_scope
    from llm.usage import collect_task_usage, current_task_usage
    from privacy.contact_mask import contact_scope, current_known_contact, install_contact_hook
    from privacy.known_contact import KnownContact

    dependencies, context, _, _ = generation
    context.career_library.summary = "Synthetic Candidate builds software."
    privacy = KnownContact.from_values(names=["Synthetic Candidate"])
    install_contact_hook(resume_tailoring_agent)
    monkeypatch.chdir(tmp_path)
    active = 0
    peak = 0
    arrived = set()
    all_started = None
    async def generate(messages, info):
        nonlocal active, peak, all_started
        assert current_known_contact() is privacy
        assert current_task_usage() is accounting
        assert "Synthetic Candidate" not in messages[-1].parts[-1].content
        section = section_name(messages)
        if section == "summary":
            assert active == 0
            assert arrived == {"experience", "projects", "skills"}
        else:
            if all_started is None:
                all_started = asyncio.Event()
            active += 1
            peak = max(peak, active)
            arrived.add(section)
            if len(arrived) == 3:
                all_started.set()
            try:
                await asyncio.wait_for(all_started.wait(), 2)
            finally:
                active -= 1
        return answer(info, selected_output(section))

    offline_model_resolution(dependencies.settings.resume_tailoring_model, FunctionModel(generate, model_name="openai:gpt-5-mini"))
    message = task()
    settings = dependencies.settings.model_copy(update={"worker_environment": "local"})
    with (contact_scope(privacy), collect_task_usage() as accounting,
          conversation_scope(message, settings, uuid4(), 1)):
        result = handle_ai_task(message, dependencies)
        assert sum(item.input_tokens for item in accounting.entries) == 44
        assert not accounting.incomplete
    assert result.status == "completed"
    assert peak == 3
    logs = list(tmp_path.glob("conversation_logs/**/*.md"))
    assert len(logs) == 1
    transcript = logs[0].read_text()
    assert transcript.count("Request snapshot") == 4
    assert "Synthetic Candidate" not in transcript
    assert "«name»" in transcript
    assert str(message.ai_task_id) in transcript


def test_failed_writer_cancels_peers_before_failed_result_and_retains_costs(
    generation, offline_model_resolution,
):
    import json

    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message

    dependencies, _, _, _ = generation
    active = set()
    arrived = set()
    all_started = None
    skills_answered = None
    cancelled = []
    attempts = []

    async def generate(messages, info):
        nonlocal all_started, skills_answered
        section = section_name(messages)
        assert section != "summary"
        if all_started is None:
            all_started, skills_answered = asyncio.Event(), asyncio.Event()
        active.add(section)
        arrived.add(section)
        if len(arrived) == 3:
            all_started.set()
        try:
            await asyncio.wait_for(all_started.wait(), 2)
            if section == "skills":
                skills_answered.set()
                return answer(info, selected_output(section))
            if section == "experience":
                await skills_answered.wait()
                attempts.append(section)
                return answer(info, {"nothing_fits": False, "entries": [{"label": "E99", "prose": []}]})
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(section)
        finally:
            active.discard(section)

    model = FunctionModel(generate, model_name="openai:gpt-5-mini")
    offline_model_resolution(dependencies.settings.resume_tailoring_model, model)
    offline_model_resolution(dependencies.settings.generative_fallback_model, model)
    queue = FakeResultQueue()
    assert process_task_message(task().model_dump_json(), 1, queue, dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "failed"
    assert result["result"] is None
    assert any(report["record_type"] == "experience" and "company" in report["fingerprints"]
               for report in result["record_screening"])
    assert active == set()
    assert cancelled == ["projects"]
    assert len(attempts) == 2
    assert sum(item["input_tokens"] for item in result["usage"]) == 33
    assert result["usage_incomplete"] is True


def test_task_deadline_awaits_writers_and_preserves_transient_retry(generation, offline_model_resolution):
    import json

    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message

    dependencies, _, _, _ = generation
    dependencies = replace(dependencies, settings=dependencies.settings.model_copy(update={"llm_run_timeout_seconds": 0.5}))
    active = set()
    started = set()
    stopped = []

    async def generate(messages, info):
        section = section_name(messages)
        assert section != "summary"
        active.add(section)
        started.add(section)
        try:
            await asyncio.Event().wait()
        finally:
            active.remove(section)
            stopped.append(section)

    offline_model_resolution(dependencies.settings.resume_tailoring_model, FunctionModel(generate))
    queue = FakeResultQueue()
    assert not process_task_message(task().model_dump_json(), 1, queue, dependencies)
    assert started == {"experience", "projects", "skills"}
    assert set(stopped) == started
    assert active == set()
    reports = [json.loads(raw) for raw in queue.sent_bodies]
    assert all(report["status"] == "usage" for report in reports)
    assert reports[-1]["attempt_finished"] is True
    assert reports[-1]["usage_incomplete"] is True


def test_missing_job_fails_before_model_request(generation):
    dependencies, _, seen, model = generation
    dependencies = replace(dependencies, read_gap_analysis_context=lambda *_: None)
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "failed"
    assert result.error_message == "This job no longer exists."
    assert result.result is None
    assert seen == []


def test_rejected_job_fails_before_generation(generation, monkeypatch):
    dependencies, context, seen, model = generation
    context.job.title = "attack"
    async def reject(text, *_):
        return UserTextScreenRun(UserTextScreen(prompt_injection="attack" in text, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1., "harmful_request": 1.}, RunUsage(input_tokens=7))
    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", reject)

    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "failed"
    assert "couldn't be used" in result.error_message or "couldn't use" in result.error_message
    assert result.result is None
    assert seen == []


def test_overlong_prompt_fails_without_returning_partial_sections(generation, monkeypatch):
    import text_limits

    dependencies, _, seen, model = generation
    monkeypatch.setattr(text_limits, "MAX_PROMPT_TEXT", 1)
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "failed"
    assert result.error_message == text_limits.TAILOR_PROMPT_TOO_LONG_MESSAGE
    assert result.result is None
    assert seen == []


def test_rejected_copied_evidence_remains_visible_but_cannot_ground_summary(generation, monkeypatch):
    dependencies, context, seen, model = generation
    context.career_library = CareerLibrary(educations=context.career_library.educations)

    async def classify(text, *_):
        return UserTextScreenRun(UserTextScreen(prompt_injection="State University" in text, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1., "harmful_request": 1.}, RunUsage(input_tokens=7))

    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", classify)
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(task(), dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert seen == []
