"""Exercise owned live-claim DB reads as ai_reader without provider calls."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.interview_inputs import read_interview_input
from interviews.client import REAL_CONFIGURATION, Claim
from tests import test_career_library_reader as library_reader_tests
from tests.test_career_library_reader import _insert, _insert_user

admin_connection = library_reader_tests.admin_connection

pytestmark = pytest.mark.db


def seed(connection, *, saved_job=False):
    owner = _insert_user(connection, summary="Current career evidence")
    job = (
        _insert(
            connection,
            "jobs",
            user_id=owner,
            title="Current vacancy",
            description="Current job description",
        )
        if saved_job
        else None
    )
    now = datetime.now(UTC)
    session = _insert(
        connection,
        "interview_sessions",
        user_id=owner,
        status="preparing",
        execution_mode="real",
        execution_config=Jsonb(REAL_CONFIGURATION.model_dump()),
        preparation_kind="saved_job" if saved_job else "fictional_role",
        job_id=job,
        career_focus="engineering",
        setup_config=Jsonb({"question_count": 8}),
        expires_at=now + timedelta(days=1),
    )
    attempt = uuid4()
    operation = _insert(
        connection,
        "interview_session_operations",
        interview_session_id=session,
        kind="preparation",
        status="running",
        attempt_id=attempt,
        claim_generation=1,
        lease_expires_at=now + timedelta(minutes=1),
        execution_deadline=now + timedelta(minutes=2),
    )
    claim = Claim(
        operation_id=str(operation),
        kind="preparation",
        execution_mode="real",
        execution_config=REAL_CONFIGURATION,
        attempt_id=str(attempt),
        claim_generation=1,
        lease_expires_at=now + timedelta(minutes=1),
        execution_deadline=now + timedelta(minutes=2),
        payload={
            "version": 1,
            "user_id": str(owner),
            "interview_id": str(session),
            "setup": {"question_count": 8},
        },
    )
    return claim, job


def read_as_reader(connection, claim):
    with connection.transaction():
        connection.execute("SET LOCAL ROLE ai_reader")
        result = read_interview_input(connection, claim)
        connection.execute("RESET ROLE")
        return result


def test_preparation_reads_current_job_library_preferences_once(admin_connection):
    claim, job = seed(admin_connection, saved_job=True)
    admin_connection.execute(
        "UPDATE jobs SET description = %s WHERE id = %s", ("Edited current description", job)
    )
    _insert(
        admin_connection,
        "avoided_interview_questions",
        user_id=claim.payload.user_id,
        question_text="Avoid this question?",
        text_digest="synthetic",
    )
    hydrated = read_as_reader(admin_connection, claim)
    context = hydrated.payload.preparation_context
    assert context["job"]["description"] == "Edited current description"
    assert context["sources"][0]["text"] == "Current career evidence"
    assert context["avoided_questions"] == ["Avoid this question?"]


@pytest.mark.parametrize("wrong", ["owner", "attempt", "generation", "kind", "expired"])
def test_reader_rejects_wrong_owner_or_stale_claim(admin_connection, wrong):
    claim, _ = seed(admin_connection)
    if wrong == "owner":
        claim = claim.model_copy(
            update={"payload": claim.payload.model_copy(update={"user_id": str(uuid4())})}
        )
    elif wrong == "attempt":
        claim = claim.model_copy(update={"attempt_id": str(uuid4())})
    elif wrong == "kind":
        claim = claim.model_copy(update={"kind": "speech"})
    elif wrong == "generation":
        claim = claim.model_copy(update={"claim_generation": 2})
    else:
        admin_connection.execute(
            "UPDATE interview_session_operations SET lease_expires_at = now() - interval '1 second' WHERE id = %s",
            (claim.operation_id,),
        )
    with pytest.raises(ValueError, match="stale"):
        read_as_reader(admin_connection, claim)


def test_pending_saved_job_preparation_fails_when_job_deleted(admin_connection):
    claim, job = seed(admin_connection, saved_job=True)
    admin_connection.execute("DELETE FROM jobs WHERE id = %s", (job,))
    with pytest.raises(ValueError, match="saved job"):
        read_as_reader(admin_connection, claim)


def test_turn_reads_prepared_question_and_public_dialogue_after_sources_deleted(admin_connection):
    claim, job = seed(admin_connection, saved_job=True)
    connection = admin_connection
    session = claim.payload.interview_id
    question = _insert(
        connection,
        "interview_session_questions",
        interview_session_id=session,
        position=0,
        content="Prepared question?",
    )
    _insert(
        connection,
        "interview_session_messages",
        interview_session_id=session,
        question_id=question,
        kind="opening",
        content="Prepared question?",
        position=0,
        semantic_key="opening",
    )
    connection.execute("UPDATE interview_sessions SET status = 'active' WHERE id = %s", (session,))
    connection.execute("DELETE FROM jobs WHERE id = %s", (job,))
    connection.execute("UPDATE users SET summary = NULL WHERE id = %s", (claim.payload.user_id,))
    connection.execute(
        "UPDATE interview_session_operations SET kind = 'turn', question_id = %s, expected_revision = 0, submission_key = 'typed', request_fingerprint = 'fingerprint', transcription_mode = 'typed', candidate_transcript = 'Accepted reviewed answer' WHERE id = %s",
        (question, claim.operation_id),
    )
    claim = claim.model_copy(update={"kind": "turn"})
    hydrated = read_as_reader(connection, claim)
    assert hydrated.payload.question == "Prepared question?"
    assert hydrated.payload.candidate_transcript == "Accepted reviewed answer"
    assert hydrated.payload.current_dialogue[0].content == "Prepared question?"
    assert hydrated.payload.model_history == []
    assert not hydrated.payload.personal_evidence().get("sources")


def test_speech_reads_only_its_exact_saved_message(admin_connection):
    claim, _ = seed(admin_connection)
    session = claim.payload.interview_id
    question = _insert(
        admin_connection,
        "interview_session_questions",
        interview_session_id=session,
        position=0,
        content="Main question?",
    )
    message = _insert(
        admin_connection,
        "interview_session_messages",
        interview_session_id=session,
        question_id=question,
        kind="follow_up",
        content="Exact follow-up?",
        acknowledgement="A grounded acknowledgement.",
        position=0,
        semantic_key="speech",
    )
    admin_connection.execute(
        "UPDATE interview_session_operations SET kind='speech', question_id=%s, message_id=%s WHERE id=%s",
        (question, message, claim.operation_id),
    )
    result = read_as_reader(admin_connection, claim.model_copy(update={"kind": "speech"}))
    assert result.payload.text == "A grounded acknowledgement.\n\nExact follow-up?"
    assert result.payload.message_id == str(message)


def test_reader_rejects_changed_saved_settings(admin_connection):
    claim, _ = seed(admin_connection)
    changed = claim.payload.setup.model_copy(update={"question_count": 12})
    with pytest.raises(ValueError, match="settings"):
        read_as_reader(
            admin_connection,
            claim.model_copy(
                update={"payload": claim.payload.model_copy(update={"setup": changed})}
            ),
        )


def test_turn_keeps_recent_whole_dialogue_groups_under_exact_budget(admin_connection):
    claim, _ = seed(admin_connection)
    session = claim.payload.interview_id
    questions = [
        _insert(
            admin_connection,
            "interview_session_questions",
            interview_session_id=session,
            position=index,
            content=title,
        )
        for index, title in enumerate(["Old?", "Recent?", "Current?"])
    ]
    for index, (question, title, answer) in enumerate(
        [
            (questions[0], "Old?", "x" * 12000),
            (questions[1], "Recent?", "y" * (12000 - len("Recent?"))),
        ]
    ):
        _insert(
            admin_connection,
            "interview_session_messages",
            interview_session_id=session,
            question_id=question,
            position=index * 2,
            kind="opening",
            content=title,
            semantic_key=f"opening-{index}",
        )
        _insert(
            admin_connection,
            "interview_session_messages",
            interview_session_id=session,
            question_id=question,
            position=index * 2 + 1,
            kind="answer",
            content=answer,
            semantic_key=f"answer-{index}",
        )
    _insert(
        admin_connection,
        "interview_session_messages",
        interview_session_id=session,
        question_id=questions[2],
        position=4,
        kind="opening",
        content="Current?",
        semantic_key="current",
    )
    admin_connection.execute(
        "UPDATE interview_sessions SET status='active', current_question_position=2 WHERE id=%s",
        (session,),
    )
    admin_connection.execute(
        "UPDATE interview_session_operations SET kind='turn', question_id=%s, expected_revision=0, submission_key='bounded', request_fingerprint='fingerprint', transcription_mode='typed', candidate_transcript='Current answer' WHERE id=%s",
        (questions[2], claim.operation_id),
    )
    result = read_as_reader(admin_connection, claim.model_copy(update={"kind": "turn"}))
    dialogue = result.payload.earlier_dialogue
    assert [group.question_position for group in dialogue.groups] == [1]
    assert dialogue.omitted_question_positions == [0]
    assert (
        sum(len(message.content) for group in dialogue.groups for message in group.messages)
        == 12000
    )


@pytest.mark.parametrize("skipped_followup", [False, True])
def test_reader_restores_public_groups_for_retained_twelve_question_sessions(
    admin_connection, skipped_followup
):
    claim, _ = seed(admin_connection)
    session = claim.payload.interview_id
    questions = [
        _insert(
            admin_connection,
            "interview_session_questions",
            interview_session_id=session,
            position=index,
            content=f"Prepared question {index}?",
            skipped_at=datetime.now(UTC) if skipped_followup and index == 0 else None,
        )
        for index in range(12)
    ]
    position = 0
    for index, question in enumerate(questions):
        _insert(
            admin_connection,
            "interview_session_messages",
            interview_session_id=session,
            question_id=question,
            position=position,
            kind="opening",
            content=f"Prepared question {index}?",
            semantic_key=f"opening-{index}",
        )
        position += 1
        if index < 11:
            _insert(
                admin_connection,
                "interview_session_messages",
                interview_session_id=session,
                question_id=question,
                position=position,
                kind="answer",
                content=f"Accepted answer {index}.",
                semantic_key=f"answer-{index}",
            )
            position += 1
        if skipped_followup and index == 0:
            _insert(
                admin_connection,
                "interview_session_messages",
                interview_session_id=session,
                question_id=question,
                position=position,
                kind="follow_up",
                content="Skipped unanswered follow-up?",
                semantic_key="skipped",
            )
            position += 1
    admin_connection.execute(
        "UPDATE interview_sessions SET status='active', current_question_position=11, setup_config=%s WHERE id=%s",
        (Jsonb({"question_count": 12}), session),
    )
    admin_connection.execute(
        "UPDATE interview_session_operations SET kind='turn', question_id=%s, expected_revision=0, submission_key='last-of-twelve', request_fingerprint='fingerprint', transcription_mode='typed', candidate_transcript='Last reviewed answer' WHERE id=%s",
        (questions[-1], claim.operation_id),
    )
    claim = claim.model_copy(
        update={
            "kind": "turn",
            "payload": claim.payload.model_copy(
                update={"setup": claim.payload.setup.model_copy(update={"question_count": 12})}
            ),
        }
    )
    result = read_as_reader(admin_connection, claim)
    assert result.payload.question == "Prepared question 11?"
    assert [group.question_position for group in result.payload.earlier_dialogue.groups] == list(
        range(11)
    )
    assert result.payload.earlier_dialogue.omitted_question_positions == []
    for index, group in enumerate(result.payload.earlier_dialogue.groups):
        assert [(m.kind, m.content) for m in group.messages] == [
            ("opening", f"Prepared question {index}?"),
            ("answer", f"Accepted answer {index}."),
        ]
    assert "Skipped unanswered follow-up?" not in str(result.payload)
    assert "not dialogue" not in str(result.payload)
    if skipped_followup:
        assert (
            admin_connection.execute(
                "SELECT content FROM interview_session_messages WHERE semantic_key='skipped' AND interview_session_id=%s",
                (session,),
            ).fetchone()["content"]
            == "Skipped unanswered follow-up?"
        )
