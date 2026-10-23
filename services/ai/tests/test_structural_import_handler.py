"""Verify route selection at the real upload handler without external providers."""

import pytest
from pydantic import ValidationError
from pydantic_ai.usage import RunUsage

from resume_import import ResumeImportRun
from schemas.parsed_resume import ParsedResume
from tests.fakes import build_docx_bytes
from tests.test_task_handlers import FILE_KEY, build_parse_resume_task
from worker.parse_resume_handler import handle_parse_resume_task
from worker.settings import WorkerSettings


def test_structural_is_default_and_rejects_unknown_route():
    assert WorkerSettings().resume_import_strategy == "structural"
    with pytest.raises(ValidationError):
        WorkerSettings(resume_import_strategy="typo")


def test_structural_handler_skips_legacy_screen_and_parser(monkeypatch, task_dependencies):
    task_dependencies.file_storage.files[FILE_KEY] = build_docx_bytes(["Experience", "Engineer at Acme", "• Built tools"])
    calls = []

    def forbidden(*args, **kwargs):
        pytest.fail("Structural import must not call legacy screening or parsing")

    def structural(text, **kwargs):
        calls.append(text)
        return ResumeImportRun(ParsedResume(), RunUsage(), kwargs["model"], [])

    monkeypatch.setattr("worker.parse_resume_handler.screen_user_text", forbidden)
    monkeypatch.setattr("worker.parse_resume_handler.parse_resume_text", forbidden)
    monkeypatch.setattr("worker.parse_resume_handler.import_resume_text", structural)
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "completed"
    assert len(calls) == 1


@pytest.mark.parametrize("message,expected", [
    ("Input safety screening is unavailable. Please try again later.", "couldn't check"),
    ("This content could not pass the input safety check.", "deemed unsafe"),
])
def test_structural_screen_failure_never_falls_back(message, expected, monkeypatch, task_dependencies):
    from pydantic_ai_harness import InputBlocked

    from worker.model_prices import build_model_usage
    from worker.task_usage import collect_task_usage

    task_dependencies.file_storage.files[FILE_KEY] = build_docx_bytes(["Experience", "Acme"])
    charge = build_model_usage("openai:gpt-5-nano", RunUsage(input_tokens=100, output_tokens=10))

    def blocked(*args, **kwargs):
        raise InputBlocked(message)

    def forbidden(*args, **kwargs):
        pytest.fail("Must not fall back to legacy")

    monkeypatch.setattr("worker.parse_resume_handler.import_resume_text", blocked)
    monkeypatch.setattr("worker.parse_resume_handler.parse_resume_text", forbidden)
    with collect_task_usage() as observed:
        observed.entries.append(charge)
        result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "failed"
    assert expected in result.error_message
    assert result.usage == [charge]


def test_structural_restores_contact_in_unassigned_and_counts_screen_once(monkeypatch, task_dependencies):
    from schemas.parsed_resume import ParsedUnassignedHighlight
    from worker.contact_mask import install_contact_hooks
    from worker.model_prices import build_model_usage

    install_contact_hooks()
    source = "Jane Doe\njane@example.test\nExperience\n• Helped Jane Doe build tools"
    task_dependencies.file_storage.files[FILE_KEY] = build_docx_bytes(source.splitlines())
    charges = [build_model_usage("openai:gpt-5-nano", RunUsage(input_tokens=100, output_tokens=10))]
    seen = []

    def structural(text, **kwargs):
        seen.append(text)
        bullet = text.split("• ")[1]
        return ResumeImportRun(ParsedResume(unassigned_highlights=[
            ParsedUnassignedHighlight(source_id="S1", text=bullet, source_context="Experience")
        ]), RunUsage(), kwargs["model"], charges)

    monkeypatch.setattr("worker.parse_resume_handler.import_resume_text", structural)
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "completed"
    assert "jane@example.test" not in seen[0]
    assert "Jane Doe" not in seen[0]
    assert result.result["parsed_resume"]["unassigned_highlights"][0]["text"] == "Helped Jane Doe build tools"
    assert result.usage == charges


def test_structural_extraction_error_propagates_without_legacy(monkeypatch, task_dependencies):
    task_dependencies.file_storage.files[FILE_KEY] = build_docx_bytes(["Acme"])

    def broken(*args, **kwargs):
        raise ValueError("Invalid source references")

    def forbidden(*args, **kwargs):
        pytest.fail("Must not run legacy parser")

    monkeypatch.setattr("worker.parse_resume_handler.import_resume_text", broken)
    monkeypatch.setattr("worker.parse_resume_handler.parse_resume_text", forbidden)
    with pytest.raises(ValueError, match="Invalid source references"):
        handle_parse_resume_task(build_parse_resume_task(), task_dependencies)


@pytest.mark.parametrize("failure", ["length", "pages", "privacy"])
def test_structural_rejects_before_provider(failure, monkeypatch, task_dependencies):
    from documents.extract_document_text import DocumentTooLongError
    from pii import PiiDetectionError
    from text_limits import MAX_RESUME_TEXT

    task_dependencies.file_storage.files[FILE_KEY] = build_docx_bytes(["Acme"])

    def forbidden(*args, **kwargs):
        pytest.fail("Rejected source must never reach the importer")

    def extract(*args):
        if failure == "pages":
            raise DocumentTooLongError()
        return "x" * (MAX_RESUME_TEXT + 1) if failure == "length" else "Acme"

    def detect(*args, **kwargs):
        raise PiiDetectionError()

    monkeypatch.setattr("worker.parse_resume_handler.import_resume_text", forbidden)
    monkeypatch.setattr("worker.parse_resume_handler.extract_document_text", extract)
    if failure == "privacy":
        monkeypatch.setattr("pii.task_privacy.prepare_document", detect)
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "failed"
    assert "protect" in result.error_message if failure == "privacy" else "too long" in result.error_message


def test_structural_real_handler_accounts_concrete_requests_once(offline_model_resolution, task_dependencies):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai.usage import RequestUsage

    from worker.task_usage import collect_task_usage

    task_dependencies.file_storage.files[FILE_KEY] = build_docx_bytes(["Experience", "Acme | Engineer", "• Built tools"])

    async def answer(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "records": [{"type": "experience", "source_id": "S2", "fields": {
                "company": "Acme", "title": "Engineer", "highlight_ids": ["S3"]
            }}]
        })], usage=RequestUsage(input_tokens=100, output_tokens=20))

    offline_model_resolution(task_dependencies.settings.resume_parsing_model, FunctionModel(answer, model_name=task_dependencies.settings.resume_parsing_model))
    with collect_task_usage() as observed:
        result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "completed"
    assert result.result["parsed_resume"]["experiences"][0]["highlights"] == ["Built tools"]
    assert len(observed.entries) == 1
    assert sum(item.input_tokens for item in result.usage) == 100
    assert sum(item.input_tokens for item in observed.entries) == 100
    assert result.usage[0] == observed.entries[0]
