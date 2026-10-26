"""Reuse exact saved answer checks while retaining every source identity.

Rails snapshots supply field approvals and revisions; only Rails persists reports.
Generated question text is trusted by its task-specific Rails-owned caller.
"""

from collections.abc import Callable

from screening.job_fields import field_fingerprint
from screening.screen_user_text import ScreenOutcome
from screening.session import current_session
from text_limits import MAX_SCREENED_TEXT
from worker.contact_mask import mask_outbound
from worker.queue_messages import InterviewQuestionScreening


def screen_interview_field(snapshot: dict | None, field: str, text: str,
                           classify: Callable[[str], ScreenOutcome]) -> ScreenOutcome:
    """Cover one exact caller-rendered field and immediately report actual checks."""
    session = current_session()
    if len(text) > MAX_SCREENED_TEXT:
        return ScreenOutcome(False, too_long=True)
    checked = snapshot is not None and field in snapshot.get("screened_fields", [])
    fingerprint = field_fingerprint(text)
    if snapshot is not None and session is not None:
        checked = checked or any(
            report.question_id == snapshot["question_id"]
            and report.question_revision == snapshot["question_revision"]
            and (field != "answer_text" or report.answer_revision == snapshot.get("answer_revision"))
            and report.fields.get(field) == fingerprint
            for report in session.interview_question_screening)
    if checked:
        outcome = ScreenOutcome(True)
    else:
        key = ("interview_question_text", text)
        if session is not None and key in session.decisions:
            outcome = session.decisions[key]
        else:
            outcome = classify(text)
            if session is not None:
                session.decisions[key] = outcome
        if outcome.allowed and snapshot is not None and session is not None:
            session.interview_question_screening.append(InterviewQuestionScreening(
                question_id=snapshot["question_id"], question_revision=snapshot["question_revision"],
                answer_revision=snapshot.get("answer_revision"), fields={field: fingerprint}))
    if outcome.allowed and session is not None:
        session.allowed_sources.add(mask_outbound(text))
    return outcome
