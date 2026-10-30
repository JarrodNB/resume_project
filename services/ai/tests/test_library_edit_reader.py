"""Exercise owned edit commands and narrow generated-history reads as the real ai_reader."""

from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.library_edit_reader import read_library_edit
from database.library_review_reader import read_library_review
from tests import test_career_library_reader as database_fixtures
from tests.test_career_library_reader import _insert, _insert_user
from worker.queue_messages import AiTaskMessage

admin_connection = database_fixtures.admin_connection
pytestmark = pytest.mark.db


def seed(connection):
    user = _insert_user(connection)
    role = _insert(connection, "experiences", user_id=user, company="A&B", title="Engineer", description="Built tools \u2028")
    highlight = _insert(connection, "experience_highlights", experience_id=role, content="Migrated tools")
    _insert(connection, "experiences", user_id=user, company="Irrelevant", title="Private", description="Unrelated evidence")
    projection = read_library_review(connection, user, "experience", experience_id=role)
    command = {"command_version": 1, "section": "experience", "target": projection.targets[1].model_dump(),
               "root_id": str(uuid4()), "turn": 1, "feedback": "Improve clarity", "skip": False}
    identity = command["root_id"]
    _insert_task(connection, identity, user, command)
    return AiTaskMessage(ai_task_id=identity, user_id=user, task_type="improve_library_entry", input=command), role, highlight


def _insert_task(connection, identity, user, command, *, status="queued", history=None, result=None, task_type="improve_library_entry"):
    connection.execute("""INSERT INTO ai_tasks (id,user_id,task_type,status,input,message_history,result,created_at,updated_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,now(),now())""",
                       (identity, user, task_type, status, Jsonb(command), Jsonb(history or []), Jsonb(result)))


def test_reads_only_owned_selected_role_and_no_persisted_source(admin_connection):
    task, role, _ = seed(admin_connection)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    context = read_library_edit(admin_connection, task)
    assert [item.id for item in context.library.experiences] == [str(role)]
    assert "Unrelated evidence" not in context.library.model_dump_json()
    assert not context.history


def test_foreign_target_is_rejected(admin_connection):
    task, _, _ = seed(admin_connection)
    other = _insert_user(admin_connection)
    foreign_role = _insert(admin_connection, "experiences", user_id=other, company="Secret", title="Private", description="Foreign")
    foreign = read_library_review(admin_connection, other, "experience", experience_id=foreign_role)
    task.input["target"] = foreign.targets[0].model_dump()
    admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(task.input), task.ai_task_id))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    with pytest.raises(ValueError):
        read_library_edit(admin_connection, task)


def test_reads_saved_history_through_owned_chain_and_rejects_foreign_root(admin_connection):
    root, _, _ = seed(admin_connection)
    history = [{"kind": "response", "parts": []}]
    admin_connection.execute("UPDATE ai_tasks SET status='completed',message_history=%s WHERE id=%s", (Jsonb(history), root.ai_task_id))
    child = AiTaskMessage(ai_task_id=uuid4(), user_id=root.user_id, task_type=root.task_type,
                          input={**root.input, "previous_task_id": str(root.ai_task_id), "turn": 2, "feedback": "Keep the detail"})
    _insert_task(admin_connection, child.ai_task_id, child.user_id, child.input)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    context = read_library_edit(admin_connection, child)
    assert context.history == history
    assert context.initial_feedback == "Improve clarity"
    admin_connection.execute("RESET ROLE")
    admin_connection.execute("UPDATE ai_tasks SET user_id=%s WHERE id=%s", (_insert_user(admin_connection), root.ai_task_id))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    with pytest.raises(ValueError, match="Owned editing exchange"):
        read_library_edit(admin_connection, child)


def test_review_questions_resolve_from_owned_result_and_answers_stay_on_root(admin_connection):
    task, _, _ = seed(admin_connection)
    review_id = uuid4()
    target = task.input["target"]
    assessment = {**target, "questions": ["Which part?", "How verified?"], "question": "Which part?"}
    _insert_task(admin_connection, review_id, task.user_id, {}, status="completed", task_type="review_library_section",
                 result={"assessments": [assessment]})
    task.input["review_question"] = {"review_task_id": str(review_id), "answers": [{"question_index": 1, "answer": "Integration tests"}]}
    admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(task.input), task.ai_task_id))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    context = read_library_edit(admin_connection, task)
    assert context.review_question.answers[0].question == "How verified?"
    assert context.review_question.answers[0].answer == "Integration tests"
    admin_connection.execute("RESET ROLE")
    admin_connection.execute("UPDATE ai_tasks SET user_id=%s WHERE id=%s", (_insert_user(admin_connection), review_id))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    with pytest.raises(ValueError, match="Owned editing exchange"):
        read_library_edit(admin_connection, task)


def test_deferred_retry_resolves_owned_paused_history_and_rejects_wrong_tool(admin_connection):
    root, _, _ = seed(admin_connection)
    history = [{"kind": "response", "parts": []}]
    admin_connection.execute("UPDATE ai_tasks SET status='needs_user_input',message_history=%s,pending_questions=%s WHERE id=%s",
                             (Jsonb(history), Jsonb([{"id": "owned-call", "question": "Which service?"}]), root.ai_task_id))
    failed_id = uuid4()
    failed_input = {**root.input, "previous_task_id": str(root.ai_task_id), "turn": 2,
                    "question_id": "owned-call", "feedback": "Billing"}
    _insert_task(admin_connection, failed_id, root.user_id, failed_input, status="failed")
    child = AiTaskMessage(ai_task_id=uuid4(), user_id=root.user_id, task_type=root.task_type,
                          input={**failed_input, "previous_task_id": str(failed_id), "turn": 3, "feedback": "Billing API"})
    _insert_task(admin_connection, child.ai_task_id, child.user_id, child.input)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    context = read_library_edit(admin_connection, child)
    assert context.history == history and context.question_id == "owned-call"
    admin_connection.execute("RESET ROLE")
    child.input["question_id"] = "unrelated-call"
    admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(child.input), child.ai_task_id))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    with pytest.raises(ValueError, match="Deferred question"):
        read_library_edit(admin_connection, child)


@pytest.mark.parametrize("change", ["context", "move", "root", "turn"])
def test_changed_context_moved_highlight_invalid_root_and_turn_are_rejected(admin_connection, change):
    task, role, highlight = seed(admin_connection)
    if change == "context":
        admin_connection.execute("UPDATE experiences SET description='Edited context' WHERE id=%s", (role,))
    elif change == "move":
        destination = _insert(admin_connection, "experiences", user_id=task.user_id, company="Different", title="New role", description="New")
        admin_connection.execute("UPDATE experience_highlights SET experience_id=%s WHERE id=%s", (destination, highlight))
    else:
        task.input["root_id" if change == "root" else "turn"] = str(uuid4()) if change == "root" else 9
        admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(task.input), task.ai_task_id))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    with pytest.raises(ValueError):
        read_library_edit(admin_connection, task)


def test_retained_legacy_source_and_history_copies_are_ignored(admin_connection):
    task, _, _ = seed(admin_connection)
    task.input.pop("command_version")
    task.input.update(library={"summary": "Forged copied evidence"}, original_text="Forged original",
                      history=[{"content": "Unowned copied history"}])
    admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(task.input), task.ai_task_id))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    context = read_library_edit(admin_connection, task)
    assert context.library.experiences[0].description == "Built tools \u2028"
    assert "Forged" not in context.library.model_dump_json()
    assert context.history == []


@pytest.mark.parametrize("section", ["summary", "projects", "career_contexts"])
def test_narrative_targets_read_only_the_selected_owned_record(admin_connection, section):
    user = _insert_user(admin_connection, summary="Owned summary")
    other = _insert_user(admin_connection, summary="Foreign summary")
    if section == "summary":
        identity = user
    elif section == "projects":
        identity = _insert(admin_connection, "projects", user_id=user, name="Selected", description="Owned project")
        _insert(admin_connection, "projects", user_id=user, name="Unselected", description="Irrelevant")
        _insert(admin_connection, "projects", user_id=other, name="Foreign", description="Private")
    else:
        identity = _insert(admin_connection, "career_contexts", user_id=user, requirement="Selected", response="Owned fact")
        _insert(admin_connection, "career_contexts", user_id=user, requirement="Unselected", response="Irrelevant")
        _insert(admin_connection, "career_contexts", user_id=other, requirement="Foreign", response="Private")
    projection = read_library_review(admin_connection, user, section, record_id=identity)
    root_id = uuid4()
    command = {"command_version": 1, "section": section, "target": projection.targets[0].model_dump(),
               "root_id": str(root_id), "turn": 1, "feedback": "Clarify", "skip": False}
    _insert_task(admin_connection, root_id, user, command)
    task = AiTaskMessage(ai_task_id=root_id, user_id=user, task_type="improve_library_entry", input=command)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    context = read_library_edit(admin_connection, task)
    assert "Owned" in context.library.model_dump_json()
    assert all(value not in context.library.model_dump_json() for value in ("Foreign", "Private", "Irrelevant"))


def test_legacy_scalar_review_answer_is_resolved_once_without_duplicate_feedback(admin_connection):
    task, _, _ = seed(admin_connection)
    review_id = uuid4()
    _insert_task(admin_connection, review_id, task.user_id, {}, status="completed", task_type="review_library_section",
                 result={"assessments": [{**task.input["target"], "question": "Which service?"}]})
    task.input.pop("command_version")
    task.input.update(feedback="Billing API", review_question={"review_task_id": str(review_id), "question": "Copied question ignored"})
    admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(task.input), task.ai_task_id))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    context = read_library_edit(admin_connection, task)
    assert context.feedback == ""
    assert context.review_question.answers[0].answer == "Billing API"
    assert context.review_question.answers[0].question == "Which service?"
