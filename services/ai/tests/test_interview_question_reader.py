"""Read practice sources with the real restricted role; all synthetic writes roll back."""
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from tests import test_career_library_reader as fixtures
from tests.test_career_library_reader import _insert, _insert_user
from worker.queue_messages import AiTaskMessage

pytestmark = pytest.mark.db


@pytest.fixture
def admin_connection():
    yield from fixtures.admin_connection.__wrapped__()


def saved_task(connection, replacement=False):
    owner = _insert_user(connection)
    set_id = _insert(connection, "interview_question_sets", user_id=owner, number=1)
    command = {"source_version": 1, "question_set_id": str(set_id), "set_type": "general", "set_number": 1}
    subject = set_id
    kind = "generate_interview_questions"
    if replacement:
        questions = [_insert(connection, "interview_questions", interview_question_set_id=set_id,
                             position=i + 1, question_text=f"Generated question {i}?") for i in range(5)]
        subject = questions[0]
        kind = "regenerate_interview_question"
        command.update(question_id=str(subject), question_revision=1, answer_revision=0,
                       peer_revisions={str(q): 1 for q in questions[1:]})
    task_id = _insert(connection, "ai_tasks", user_id=owner, subject_id=subject,
                      subject_type="InterviewQuestion" if replacement else "InterviewQuestionSet",
                      task_type=kind, status="queued", input=Jsonb(command))
    return AiTaskMessage(ai_task_id=task_id, user_id=owner, task_type=kind, input=command)


def test_loads_current_owned_sources_and_ignores_transport_copies(admin_connection):
    from database.interview_questions import read_interview_question_sources
    task = saved_task(admin_connection)
    other = _insert_user(admin_connection)
    for owner, text in [(task.user_id, "Owned preference?"), (other, "Foreign preference?")]:
        _insert(admin_connection, "avoided_interview_questions", user_id=owner, question_text=text, text_digest=str(uuid4()))
        set_id = _insert(admin_connection, "interview_question_sets", user_id=owner, number=2)
        _insert(admin_connection, "interview_questions", interview_question_set_id=set_id, position=1, question_text=text)
    task.input["avoided_questions"] = ["Untrusted copy?"]
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    sources = read_interview_question_sources(admin_connection, task)
    assert sources["avoided_questions"] == ["Owned preference?"]
    assert sources["recent_questions"] == ["Owned preference?"]
    assert "answer_text" not in sources


@pytest.mark.parametrize("mismatch", ["owner", "subject", "revision", "peers", "terminal"])
def test_rejects_ineligible_replacements(admin_connection, mismatch):
    from database.interview_questions import read_interview_question_sources
    task = saved_task(admin_connection, replacement=True)
    if mismatch == "owner":
        task = task.model_copy(update={"user_id": uuid4()})
    elif mismatch == "subject":
        admin_connection.execute("UPDATE ai_tasks SET subject_id = %s WHERE id = %s", (uuid4(), task.ai_task_id))
    elif mismatch == "revision":
        admin_connection.execute("UPDATE interview_questions SET question_revision = 2 WHERE id = %s", (task.input["question_id"],))
    elif mismatch == "peers":
        admin_connection.execute("UPDATE interview_questions SET question_revision = 2 WHERE id = %s", (next(iter(task.input["peer_revisions"])),))
    else:
        admin_connection.execute("UPDATE ai_tasks SET status = 'completed' WHERE id = %s", (task.ai_task_id,))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_interview_question_sources(admin_connection, task) is None


def test_reads_exact_five_active_owned_questions_without_answers(admin_connection):
    from database.interview_questions import read_interview_question_sources
    task = saved_task(admin_connection, replacement=True)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    sources = read_interview_question_sources(admin_connection, task)
    assert sources["question_text"] == "Generated question 0?"
    assert sources["other_questions"] == [f"Generated question {i}?" for i in range(1, 5)]
    assert "answer_text" not in sources


@pytest.mark.parametrize("changed", [False, True])
def test_retained_commands_use_saved_records_and_reject_stale_sources(admin_connection, changed):
    from database.interview_questions import read_interview_question_sources
    task = saved_task(admin_connection, replacement=True)
    command = {key: value for key, value in task.input.items() if key not in {"source_version", "peer_revisions"}}
    command.update(question_text="Generated question 0?", other_questions=[f"Generated question {i}?" for i in range(1, 5)],
                   avoided_questions=["Old preference copy?"])
    admin_connection.execute("UPDATE ai_tasks SET input = %s WHERE id = %s", (Jsonb(command), task.ai_task_id))
    if changed:
        admin_connection.execute("UPDATE interview_questions SET question_text = 'Changed peer?' WHERE id = %s",
                                 (next(iter(task.input["peer_revisions"])),))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    sources = read_interview_question_sources(admin_connection, task)
    if changed:
        assert sources is None
    else:
        assert sources["avoided_questions"] == []
        assert len(sources["other_questions"]) == 4


def test_recent_history_is_bounded_active_and_same_type(admin_connection):
    from database.interview_questions import read_interview_question_sources
    task = saved_task(admin_connection)
    for number in range(2, 8):
        set_id = _insert(admin_connection, "interview_question_sets", user_id=task.user_id, number=number)
        for slot in range(1, 6):
            _insert(admin_connection, "interview_questions", interview_question_set_id=set_id,
                    position=slot, question_text=f"Practice {number}-{slot}?")
    technical = _insert(admin_connection, "interview_question_sets", user_id=task.user_id, number=8, set_type="technical")
    _insert(admin_connection, "interview_questions", interview_question_set_id=technical, position=1, question_text="Wrong type?")
    _insert(admin_connection, "interview_questions", interview_question_set_id=technical, position=None,
            retired_at="2026-10-01", question_text="Retired?")
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    recent = read_interview_question_sources(admin_connection, task)["recent_questions"]
    assert len(recent) == 20
    assert all(question.startswith("Practice") for question in recent)
