"""Exercise import privacy at real provider boundaries with synthetic documents."""

import json
import re

import logfire
import psycopg
import pytest
from opentelemetry import trace
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from pii import PiiRestorationError, prepare_document
from privacy.contact_mask import import_privacy_scope, install_contact_hooks, mask_outbound
from privacy.known_contact import KnownContact
from screening.screen_user_text import ScreenOutcome
from tests import test_tracing
from tests.fakes import build_docx_bytes
from tests.test_process_task_message import FakeResultQueue
from tests.test_task_handlers import FILE_KEY, build_parse_resume_task
from worker import main
from worker.parse_resume_handler import RESUME_PRIVACY_MESSAGE, handle_parse_resume_task

SOURCE = "Jane Doe\njane@example.test\n+1 415-555-2671\nEngineer at Acme\nHelped Jane Doe ship Python services."


@pytest.fixture
def exporters():
    yield from test_tracing.exporters.__wrapped__()


@pytest.fixture(autouse=True)
def privacy_hooks():
    """Exercise production hooks, including when profile contact is empty."""
    install_contact_hooks()


@pytest.mark.real_guardrail
def test_import_masks_both_providers_and_restores_before_source_checks(
    task_dependencies, fake_file_storage, offline_model_resolution, monkeypatch,
):
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test")
    task_dependencies.settings.generative_fallback_model = task_dependencies.settings.resume_parsing_model
    source_lines = [*SOURCE.splitlines(), "• Helped Jane Doe ship Python services."]
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(source_lines)
    seen = []

    def screen(messages, info):
        seen.append(("screen", str(messages)))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    def parse(messages, info):
        prompt = messages[-1].parts[-1].content
        seen.append(("parse", prompt))
        tokens = re.findall(r"«pii:[^»]+»", prompt)
        assert tokens, "Import text must be masked before reaching a provider"
        name, email, phone = prompt.split("<resume>\n", 1)[1].splitlines()[:3]
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "contact": {"full_name": name, "email": email, "phone": phone},
            "experiences": [{"company": "Acme", "title": "Engineer",
                "highlights": [f"Helped {name} ship Python services."]}],
        })])

    offline_model_resolution(task_dependencies.settings.user_text_screen_model,
        FunctionModel(screen))
    offline_model_resolution(task_dependencies.settings.resume_parsing_model,
        FunctionModel(parse))
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "completed"
    assert [kind for kind, _ in seen] == ["screen", "parse", "parse", "parse"]
    for _, request in seen:
        for secret in ("Jane Doe", "jane@example.test", "+1 415-555-2671"):
            assert secret not in request
    parsed = result.result["parsed_resume"]
    assert parsed["contact"] == {"full_name": "Jane Doe", "email": "jane@example.test",
        "phone": "+1 415-555-2671", "location": None, "links": []}
    assert parsed["experiences"][0]["highlights"] == ["Helped Jane Doe ship Python services."]
    assert "«pii:" not in json.dumps(result.result)


def test_detector_failure_never_reaches_either_provider(
    monkeypatch, task_dependencies, fake_file_storage,
):
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(SOURCE.splitlines())

    def unavailable():
        raise RuntimeError(SOURCE)

    def forbidden(*args, **kwargs):
        pytest.fail("No external provider may run when local detection fails")

    monkeypatch.setattr("pii._analyzer", unavailable)
    monkeypatch.setattr("worker.parse_resume_handler.screen_user_text", forbidden)
    monkeypatch.setattr("worker.parse_resume_handler.parse_resume_text", forbidden)
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "failed"
    assert result.error_message == RESUME_PRIVACY_MESSAGE
    assert SOURCE not in result.model_dump_json()


def test_original_limit_precedes_detection(monkeypatch, task_dependencies, fake_file_storage):
    from text_limits import MAX_RESUME_TEXT, RESUME_TOO_LONG_MESSAGE

    fake_file_storage.files[FILE_KEY] = b"fake"
    monkeypatch.setattr("worker.parse_resume_handler.extract_document_text",
        lambda *args: "x" * (MAX_RESUME_TEXT + 1))
    monkeypatch.setattr("pii._analyzer", lambda: pytest.fail("Must reject before detection"))
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.error_message == RESUME_TOO_LONG_MESSAGE


def test_incomplete_generated_tokens_fail_but_source_literals_round_trip():
    original = "Literal «name» «pii:source:PERSON:1» «PII:SOURCE:PERSON:2» and «PII:partial"
    masked, session = prepare_document(original)
    assert session.restore(masked) == original
    with pytest.raises(PiiRestorationError):
        session.restore("Generated «pii:unknown:PERSON:1")
    with pytest.raises(PiiRestorationError):
        session.restore("Generated «PII:unknown:PERSON:1")


def test_changed_generated_token_case_is_rejected():
    masked, session = prepare_document("Jane Doe", names=["Jane Doe"])
    with pytest.raises(PiiRestorationError):
        session.restore(masked.upper())


def test_masking_preserves_exact_source_case_and_tokens_when_name_matches_marker():
    original = "PERSON person Person"
    masked, session = prepare_document(original, names=["PERSON"])
    assert session.mask(masked) == masked
    assert session.restore(masked) == original
    assert "PERSON" not in session.mask("Person outside source").split("»")[-1]


def test_import_privacy_survives_parent_spans_and_delayed_export(exporters):
    spans, _ = exporters
    known = KnownContact.from_values(names=["Profile Person"], emails=["profile@example.test"])
    with import_privacy_scope(known) as privacy, logfire.span("before detection"):
        masked = privacy.prepare(SOURCE + "\nLiteral «name» and «pii:source:PERSON:4»")
        assert privacy.restore(masked) == SOURCE + "\nLiteral «name» and «pii:source:PERSON:4»"
        with trace.get_tracer("privacy").start_as_current_span("restored") as span:
            span.set_attribute("restored", SOURCE)
            span.add_event("PROFILE PERSON", {"error": "PROFILE@EXAMPLE.TEST"})
            span.record_exception(ValueError(SOURCE))
        logfire.info("restored output", output=SOURCE)
    assert mask_outbound(SOURCE) == SOURCE
    logfire.force_flush(timeout_millis=1000)
    rendered = repr([(s.name, dict(s.attributes),
                      [(e.name, dict(e.attributes)) for e in s.events], s.status.description)
                     for s in spans.get_finished_spans()])
    for secret in ("Jane Doe", "jane@example.test", "+1 415-555-2671", "PROFILE PERSON", "PROFILE@EXAMPLE.TEST"):
        assert secret not in rendered
    assert "«pii:" in rendered
    parent = next(s for s in spans.get_finished_spans() if s.name == "before detection")
    assert parent is not None


def test_exception_logging_keeps_import_privacy_after_task_span(
    monkeypatch, task_dependencies, exporters,
):
    spans, logs = exporters

    def crash(task, dependencies):
        with import_privacy_scope() as privacy:
            privacy.prepare(SOURCE)
        raise ValueError(SOURCE)

    monkeypatch.setattr(main, "handle_ai_task", crash)
    # Forward ordinary task logging to the configured remote-telemetry seam while
    # preserving the active exception. The catch runs after the root task span exits.
    monkeypatch.setattr(main.logger, "exception", lambda *args: logfire.exception("task failed"))
    queue = FakeResultQueue()
    assert main.process_task_message(build_parse_resume_task().model_dump_json(), 1, queue, task_dependencies)
    assert json.loads(queue.sent_bodies[-1])["error_message"] == "The AI task failed"
    logfire.force_flush(timeout_millis=1000)
    rendered = repr([(s.name, dict(s.attributes),
                      [(e.name, dict(e.attributes)) for e in s.events], s.status.description)
                     for s in spans.get_finished_spans()])
    rendered += repr([(r.log_record.body, r.log_record.attributes) for r in logs.get_finished_logs()])
    assert "ValueError" in rendered
    for secret in ("Jane Doe", "jane@example.test", "+1 415-555-2671"):
        assert secret not in rendered


def test_profile_loader_failure_keeps_usage_and_retry(monkeypatch, task_dependencies):
    def unavailable(task):
        raise psycopg.OperationalError("Profile database unavailable")

    monkeypatch.setattr("worker.contact_context._load_known_contact", unavailable)
    queue = FakeResultQueue()
    assert not main.process_task_message(build_parse_resume_task().model_dump_json(), 1, queue, task_dependencies)
    assert [json.loads(body)["status"] for body in queue.sent_bodies] == ["usage", "usage"]


def test_import_filename_never_enters_pending_telemetry(monkeypatch, task_dependencies, exporters):
    spans, _ = exporters
    task = build_parse_resume_task()
    task.input["source_file"]["filename"] = "Unknown Person unknown@example.test.docx"

    def fail_without_detection(task, dependencies):
        raise RuntimeError("Failure before extraction")

    monkeypatch.setattr(main, "handle_ai_task", fail_without_detection)
    assert main.process_task_message(task.model_dump_json(), 1, FakeResultQueue(), task_dependencies)
    logfire.force_flush(timeout_millis=1000)
    rendered = repr([(s.name, s.attributes, s.events) for s in spans.get_finished_spans()])
    assert "Unknown Person" not in rendered
    assert "unknown@example.test" not in rendered


@pytest.mark.parametrize("output", ["«pii:unknown:PERSON:4»", "«pii:truncated"])
def test_unresolved_output_fails_safely_with_usage(
    output, monkeypatch, task_dependencies, fake_file_storage,
):
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(SOURCE.splitlines())
    monkeypatch.setattr("worker.parse_resume_handler.screen_user_text",
        lambda *args, **kwargs: ScreenOutcome(True))
    monkeypatch.setattr(
        "agents.resume_parsing_agent.generative_model",
        lambda *_args: TestModel(custom_output_args={"summary": output}),
    )
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "failed"
    assert result.error_message == RESUME_PRIVACY_MESSAGE
    assert result.result is None
    assert result.usage[0].input_tokens > 0


def test_mask_expansion_does_not_change_original_document_limit(
    monkeypatch, task_dependencies, fake_file_storage,
):
    from text_limits import MAX_RESUME_TEXT

    source = "jane@example.test " * 100
    source += "x" * (MAX_RESUME_TEXT - len(source))
    fake_file_storage.files[FILE_KEY] = b"fake"
    monkeypatch.setattr("worker.parse_resume_handler.extract_document_text", lambda *args: source)

    def screen(text, **kwargs):
        assert len(text) > MAX_RESUME_TEXT
        assert kwargs["max_characters"] == len(text)
        return ScreenOutcome(True)

    monkeypatch.setattr("worker.parse_resume_handler.screen_user_text", screen)
    monkeypatch.setattr(
        "agents.resume_parsing_agent.generative_model",
        lambda *_args: TestModel(custom_output_args={}),
    )
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "completed"


@pytest.mark.real_guardrail
def test_duplicate_deliveries_fallback_and_validation_retry_are_isolated(
    monkeypatch, task_dependencies, fake_file_storage, offline_model_resolution, tmp_path,
):
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test")
    monkeypatch.chdir(tmp_path)
    task_dependencies.settings.worker_environment = "local"
    task_dependencies.settings.conversation_logging_enabled = True
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(SOURCE.splitlines())
    seen = []
    attempts = []

    def screen(messages, info):
        seen.append(str(messages))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    def primary(messages, info):
        seen.append(str(messages))
        raise ModelHTTPError(503, "synthetic", "unavailable")

    def fallback(messages, info):
        seen.append(str(messages))
        prompt = next(part.content for part in messages[0].parts if hasattr(part, "content")
                      and isinstance(part.content, str) and "<resume>" in part.content)
        name = prompt.split("<resume>\n", 1)[1].splitlines()[0]
        if "contact" not in info.output_tools[0].parameters_json_schema["properties"]:
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])
        attempts.append(name)
        # First profile reply on each run is invalid; retry the same masked history.
        args = {"contact": {"full_name": 42}} if len(attempts) % 2 else {"contact": {"full_name": name}}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution(task_dependencies.settings.user_text_screen_model, FunctionModel(screen))
    offline_model_resolution(task_dependencies.settings.resume_parsing_model, FunctionModel(primary))
    offline_model_resolution(task_dependencies.settings.generative_fallback_model, FunctionModel(fallback))
    task = build_parse_resume_task()
    queue = FakeResultQueue()
    for _ in range(2):
        assert main.process_task_message(task.model_dump_json(), 1, queue, task_dependencies)
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(SOURCE.replace("Jane Doe", "John Smith").splitlines())
    other_task = build_parse_resume_task()
    assert main.process_task_message(other_task.model_dump_json(), 1, queue, task_dependencies)
    completed = [json.loads(body) for body in queue.sent_bodies if json.loads(body)["status"] == "completed"]
    assert len(completed) == 3
    assert completed[0]["result"] == completed[1]["result"]
    assert completed[0]["result"]["parsed_resume"]["contact"]["full_name"] == "Jane Doe"
    assert completed[2]["result"]["parsed_resume"]["contact"]["full_name"] == "John Smith"
    assert len(attempts) == 6
    assert attempts[0] == attempts[1] and attempts[2] == attempts[3]
    assert attempts[0] != attempts[2]
    for request in seen:
        assert "Jane Doe" not in request
        assert "John Smith" not in request
        assert "jane@example.test" not in request
    transcripts = list(tmp_path.glob("conversation_logs/**/*.md"))
    assert len(transcripts) == 2
    transcript = "\n".join(path.read_text() for path in transcripts)
    assert "Request snapshot" in transcript and "«pii:" in transcript
    for secret in ("Jane Doe", "John Smith", "jane@example.test", "+1 415-555-2671"):
        assert secret not in transcript
    assert mask_outbound(SOURCE) == SOURCE
