"""Read owned saved sections and inspect an export locally, without model calls."""

from hashlib import sha256

from documents.ats_pdf import inspect_pdf
from worker.queue_messages import AiResultMessage


def handle_ats_pdf_task(task, dependencies):
    request = task.input
    snapshot = dependencies.read_ats_snapshot(task.user_id, request["run_id"])
    keys = ("resume_id", "content_fingerprint", "rubric_version")
    if (
        snapshot is None
        or any(str(getattr(snapshot, key)) != request.get(key) for key in keys)
        or snapshot.pdf_result.get("task_id") != str(task.ai_task_id)
        or any(
            snapshot.pdf_result.get(key) != request.get(key)
            for key in ("digest", "renderer_version")
        )
        or request.get("renderer_version") != "resume-pdf-v1"
    ):
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="PDF snapshot changed or is unavailable. Export again.",
        )
    data = dependencies.file_storage.download_file(request["source_file"]["key"])
    if sha256(data).hexdigest() != request.get("digest"):
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="PDF bytes do not match this export. Export again.",
        )
    try:
        findings = inspect_pdf(data, snapshot.content_snapshot)
    except ValueError as error:
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message=str(error)
        )
    identity = {
        key: request[key]
        for key in (
            "run_id",
            "resume_id",
            "content_fingerprint",
            "rubric_version",
            "renderer_version",
            "digest",
        )
    }
    return AiResultMessage(
        ai_task_id=task.ai_task_id, status="completed", result={**identity, **findings}
    )
