"""Reuse exact saved practice-field checks while retaining every source identity.

Rails snapshots supply field approvals and revisions; only Rails persists reports.
Legacy sibling strings still receive screening without claiming a saved identity.
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


def sibling_snapshots(snapshot) -> list[dict | None]:
    """Require aligned, distinct identities and exact text before trusting sibling metadata."""
    peers = snapshot.other_question_snapshots
    if len(peers) != len(snapshot.other_questions):
        return [None] * len(snapshot.other_questions)
    ids = [peer.get("question_id") for peer in peers if isinstance(peer, dict)]
    if (len(ids) != len(peers) or not all(isinstance(id, str) and id for id in ids)
        or len(set(ids)) != len(ids) or str(snapshot.question_id) in ids):
        return [None] * len(snapshot.other_questions)
    sources = []
    for text, peer in zip(snapshot.other_questions, peers, strict=True):
        if (not isinstance(peer.get("question_id"), str) or not peer["question_id"]
            or peer.get("question_set_id") != str(snapshot.question_set_id)
            or peer.get("question_text") != text
            or type(peer.get("question_revision")) is not int or peer["question_revision"] < 1
            or not isinstance(peer.get("screened_fields", []), list)
            or not all(isinstance(name, str) for name in peer.get("screened_fields", []))):
            sources.append(None)
        else:
            sources.append(peer)
    return sources
