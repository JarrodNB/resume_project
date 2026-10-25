"""Reuse checks for the saved job fields actually shown to gap analysis and tailoring.

Unchecked fields are screened together as readable text. Successful reports retain
typed-value fingerprints so Rails approves only the same owned values still saved.
Callers keep complete-source limits and supply only exact sources built from these fields.
"""

import hashlib
import json
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from schemas.gap_analysis_context import JobToAnalyze
from screening.session import current_session
from worker.contact_mask import mask_outbound
from worker.queue_messages import JobScreening

JOB_FIELDS = ("title", "company", "requirements", "nice_to_haves")
_LABELS = {"title": "Job title", "company": "Company", "requirements": "Requirements",
           "nice_to_haves": "Nice to have"}


def field_fingerprint(value: str | list[str]) -> str:
    """Match Ruby stdlib JSON.generate, not Rails' HTML-escaping JSON encoder."""
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def screen_job_fields(job: JobToAnalyze, allow_text: Callable[[str], Any], *,
                      approved_sources: Sequence[str]) -> Any:
    """Check pending used fields and cover exact caller-built sources on success.

    approved_sources may contain only these four fields and trusted formatting.
    The caller must enforce full-source limits even when every field is approved.
    """
    pending = _pending_fields(job)
    decision = allow_text(_screening_text(pending)) if pending else True
    return _finish(job, pending, decision, approved_sources)


async def screen_job_fields_async(job: JobToAnalyze, allow_text: Callable[[str], Awaitable[Any]], *,
                                  approved_sources: Sequence[str]) -> Any:
    """Use the same saved field policy with an asynchronous classifier."""
    pending = _pending_fields(job)
    decision = await allow_text(_screening_text(pending)) if pending else True
    return _finish(job, pending, decision, approved_sources)


def _pending_fields(job):
    values = {name: getattr(job, name) for name in JOB_FIELDS}
    values = {name: value for name, value in values.items()
              if (isinstance(value, str) and value.strip())
              or (isinstance(value, list) and any(item.strip() for item in value))}
    checked = set(job.screened_fields)
    if (session := current_session()) is not None:
        for report in session.job_screening:
            if report.job_id == job.id:
                checked.update(name for name, value in values.items()
                               if report.fields.get(name) == field_fingerprint(value))
    return {name: value for name, value in values.items() if name not in checked}


def _screening_text(fields):
    return "\n\n".join(f"{_LABELS[name]}:\n" + ("\n".join(value) if isinstance(value, list) else value)
                         for name, value in fields.items())


def _finish(job, pending, decision, sources):
    allowed = decision if isinstance(decision, bool) else getattr(decision, "allowed", False)
    if allowed and (session := current_session()) is not None:
        if pending:
            session.job_screening.append(JobScreening(job_id=job.id,
                fields={name: field_fingerprint(value) for name, value in pending.items()}))
        session.allowed_sources.update(mask_outbound(source) for source in sources)
    return decision
