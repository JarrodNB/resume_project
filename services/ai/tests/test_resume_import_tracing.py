"""Check contact-safe import-stage and parser-group timings and failure behavior."""

import logfire
import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from agents.resume_parsing_agent import parse_resume_text
from documents.extract_document_text import UnsupportedDocumentError
from pii import PiiDetectionError, PiiRestorationError
from screening.screen_user_text import ScreenOutcome
from tests import test_tracing
from tests.fakes import build_docx_bytes
from tests.test_task_handlers import FILE_KEY, build_parse_resume_task
from worker.parse_resume_handler import handle_parse_resume_task

STAGES = [
    "resume_import.download",
    "resume_import.extract",
    "resume_import.prepare_pii",
    "resume_import.restore_and_check_source",
]
SOURCE = "Jane Doe\njane@example.test\n+1 415-555-2671\nUnique private resume content"
FILENAME = "Jane Doe private upload.docx"
GROUP_SPANS = {
    "resume_parse.group.experience",
    "resume_parse.group.projects_skills",
    "resume_parse.group.profile",
}


@pytest.fixture
def exporters():
    yield from test_tracing.exporters.__wrapped__()


@pytest.mark.parametrize("failure", [None, "download", "extract", "prepare_pii", "screen", "restore"])
def test_import_stage_durations_and_private_failure_details(
    failure, exporters, task_dependencies, fake_file_storage, monkeypatch,
    offline_resume_model_resolution,
):
    """Only reached stages export timings, even when a pre-detection error has content."""
    task_dependencies.settings.generative_fallback_model = task_dependencies.settings.resume_parsing_model
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(SOURCE.splitlines())
    task = build_parse_resume_task()
    task.input["source_file"]["filename"] = FILENAME
    monkeypatch.setattr("worker.parse_resume_handler.screen_user_text",
        lambda *args, **kwargs: ScreenOutcome(allowed=failure != "screen"))

    def unreadable(*args):
        raise UnsupportedDocumentError(FILENAME + SOURCE)

    def unavailable(*args):
        raise RuntimeError(FILENAME + SOURCE)

    def detection_unavailable(*args):
        raise PiiDetectionError(FILENAME + SOURCE)

    def restoration_unavailable(*args):
        raise PiiRestorationError(FILENAME + SOURCE)

    if failure == "prepare_pii":
        monkeypatch.setattr("pii.task_privacy.TaskPrivacy.prepare", detection_unavailable)
    if failure == "restore":
        monkeypatch.setattr("pii.task_privacy.TaskPrivacy.restore", restoration_unavailable)
    if failure == "extract":
        monkeypatch.setattr("worker.parse_resume_handler.extract_document_text", unreadable)
    if failure == "download":
        monkeypatch.setattr(fake_file_storage, "download_file", unavailable)

    offline_resume_model_resolution(TestModel())
    with logfire.span("import task") as parent:
        if failure == "download":
            # Catch inside the parent: this test checks the added stage telemetry only.
            with pytest.raises(RuntimeError):
                handle_parse_resume_task(task, task_dependencies)
        else:
            result = handle_parse_resume_task(task, task_dependencies)
            assert result.status == ("completed" if failure is None else "failed")
        parent_id = parent.context.span_id
    logfire.force_flush(timeout_millis=1000)
    spans = exporters[0].get_finished_spans()
    stages = [span for span in spans if span.name in STAGES]
    count = {None: 4, "download": 1, "extract": 2, "prepare_pii": 3, "screen": 3,
             "restore": 4}[failure]
    assert [span.name for span in stages] == STAGES[:count]
    for span in stages:
        assert span.end_time >= span.start_time
        assert span.parent.span_id == parent_id
    rendered = repr([(span.name, dict(span.attributes), span.events, span.status)
                     for span in stages])
    for private in (SOURCE, FILENAME, "Jane Doe", "jane@example.test", "+1 415-555-2671",
                    "Unique private resume content", FILE_KEY):
        assert private not in rendered


def test_group_spans_report_static_labels_duration_and_usage_without_source(
    exporters, offline_model_resolution,
):
    """Each concurrent parser request can be measured without putting source in telemetry."""
    source = SOURCE + "\nAcme Confidential — Principal Engineer"
    offline_model_resolution("openai:gpt-5-mini", TestModel())
    run = parse_resume_text(
        source, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini"
    )
    logfire.force_flush(timeout_millis=1000)

    spans = [span for span in exporters[0].get_finished_spans() if span.name in GROUP_SPANS]
    assert {span.name for span in spans} == GROUP_SPANS
    for span in spans:
        assert span.end_time >= span.start_time
        assert span.attributes["resume_parse.group"] in {"experience", "projects_skills", "profile"}
        assert span.attributes["resume_parse.requests"] == 1
        assert isinstance(span.attributes["resume_parse.input_tokens"], int)
        assert isinstance(span.attributes["resume_parse.output_tokens"], int)
        assert not span.events
    rendered = repr([(span.name, dict(span.attributes), span.events, span.status)
                     for span in spans])
    for private in (source, "Jane Doe", "jane@example.test", "Acme Confidential",
                    "Principal Engineer", FILENAME, FILE_KEY):
        assert private not in rendered
    assert run.usage.requests == 3


def test_group_span_is_emitted_without_recording_failure_details(
    exporters, offline_model_resolution,
):
    """A failed group still has a duration span, but its exception stays out of telemetry."""
    secret = "Jane Doe private model error"

    async def fail_experience(messages, info):
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            raise RuntimeError(secret)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(fail_experience))
    with pytest.raises(RuntimeError, match="private model error"):
        parse_resume_text(SOURCE, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini")
    logfire.force_flush(timeout_millis=1000)

    failed = [span for span in exporters[0].get_finished_spans()
              if span.name == "resume_parse.group.experience"]
    assert len(failed) == 1
    assert failed[0].end_time >= failed[0].start_time
    assert not failed[0].events
    rendered = repr([(span.name, dict(span.attributes), span.events, span.status)
                     for span in failed])
    assert secret not in rendered
