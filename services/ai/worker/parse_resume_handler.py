"""
Description: Handles parse_resume tasks: downloads the uploaded file, extracts its text, and
runs the resume parsing agent. Safe to run twice (it only reads).
Index:
    - SourceFile / ParseResumeInput: the task's `input`, sent by Rails
    - handle_parse_resume_task: returns a completed result with the ParsedResume, or a failed
      result when the file has no readable text
"""

from pydantic import BaseModel

from agents.resume_parsing_agent import parse_resume_text
from documents.extract_document_text import UnsupportedDocumentError, extract_document_text
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies

UNREADABLE_FILE_MESSAGE = (
    "We couldn't read any text from this file. Upload a PDF or DOCX that isn't a scanned image."
)


class SourceFile(BaseModel):
    """The uploaded file as stored by Active Storage."""

    key: str
    filename: str
    content_type: str


class ParseResumeInput(BaseModel):
    """Input of a parse_resume task."""

    source_file: SourceFile


def handle_parse_resume_task(
    task: AiTaskMessage, dependencies: TaskDependencies
) -> AiResultMessage:
    """Parses the uploaded resume into a ParsedResume."""
    task_input = ParseResumeInput.model_validate(task.input)
    file_bytes = dependencies.file_storage.download_file(task_input.source_file.key)

    try:
        resume_text = extract_document_text(file_bytes, task_input.source_file.content_type)
    except UnsupportedDocumentError:
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message=UNREADABLE_FILE_MESSAGE
        )

    parsed_resume = parse_resume_text(resume_text, model=dependencies.settings.resume_parsing_model)
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"parsed_resume": parsed_resume.model_dump(mode="json")},
    )
