"""Check import stage durations without exporting uploaded content or error details."""

import logfire
import pytest
from pydantic_ai.models.test import TestModel

from agents.resume_parsing_agent import resume_parsing_agent
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


@pytest.fixture
def exporters():
    yield from test_tracing.exporters.__wrapped__()


@pytest.mark.parametrize("failure", [None, "download", "extract", "prepare_pii", "screen", "restore"])
def test_import_stage_durations_and_private_failure_details(
    failure, exporters, task_dependencies, fake_file_storage, monkeypatch,
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

    with logfire.span("import task") as parent, resume_parsing_agent.override(model=TestModel()):
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
