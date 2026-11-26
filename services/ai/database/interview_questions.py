"""Load saved written-practice sources after checking the durable task and its owner.

Commands carry identities and revisions. Source text stays in its domain tables;
versioned commands fail when their saved fences change. Rails builds and re-checks the same
command in InterviewPrep::PracticeTaskFence; tests/fixtures/practice_task_fence_cases.json keeps
the two sides together, including the checks only one side makes.
"""
from active_answer import has_answer_text
from database.open_read_only_connection import open_read_only_connection


def read_interview_question_sources(connection, task):
    """Return prompt sources for an eligible queued task, otherwise no paid work."""
    row = connection.execute("""
        SELECT input, subject_id, subject_type FROM ai_tasks
        WHERE id = %(task)s AND user_id = %(owner)s AND task_type = %(kind)s AND status = 'queued'
    """, {"task": task.ai_task_id, "owner": task.user_id, "kind": task.task_type}).fetchone()
    if not row or task.task_type not in {"generate_interview_questions", "regenerate_interview_question", "review_interview_answer", "generate_interview_memory_anchor"}:
        return None
    command = row["input"]
    if command.get("source_version") != 1:
        return None
    question_set = connection.execute("""
        SELECT id, number, set_type, origin FROM interview_question_sets
        WHERE id = %(set)s AND user_id = %(owner)s
    """, {"set": command.get("question_set_id"), "owner": task.user_id}).fetchone()
    if not question_set or question_set["set_type"] != command.get("set_type"):
        return None
    if task.task_type in {"review_interview_answer", "generate_interview_memory_anchor"}:
        if row["subject_type"] != "InterviewQuestion" or str(row["subject_id"]) != command.get("question_id"):
            return None
        target = connection.execute("""
            SELECT q.id, q.question_text, q.answer_text, q.answer_format, q.answer_drafts -> q.answer_format AS answer_fields, q.question_revision, q.answer_revision, q.screened_fields
            FROM interview_questions q JOIN interview_question_sets s ON s.id = q.interview_question_set_id
            WHERE q.id = %(question)s AND s.id = %(set)s AND s.user_id = %(owner)s AND q.retired_at IS NULL
        """, {"question": command.get("question_id"), "set": question_set["id"], "owner": task.user_id}).fetchone()
        if not target or not has_answer_text(target["answer_text"]) or any(
            target[key] != command.get(key) for key in ("question_revision", "answer_revision")
        ):
            return None
        return {"question_set_id": str(question_set["id"]), "set_type": question_set["set_type"],
                "origin": question_set["origin"], "question_id": str(target["id"]),
                "answer_fields": target["answer_fields"] or (
                    {"text": target["answer_text"]} if target["answer_format"] == "plain_text" else {}), **{key: target[key] for key in (
                    "question_text", "answer_text", "answer_format", "question_revision", "answer_revision", "screened_fields")}}
    questions = connection.execute("""
        SELECT q.id, q.question_text, q.question_revision, q.answer_revision, q.screened_fields
        FROM interview_questions q JOIN interview_question_sets s ON s.id = q.interview_question_set_id
        WHERE s.id = %(set)s AND s.user_id = %(owner)s AND q.retired_at IS NULL
        ORDER BY q.position, q.id
    """, {"set": question_set["id"], "owner": task.user_id}).fetchall()
    sources = {"question_set_id": str(question_set["id"]), "set_type": question_set["set_type"]}
    replacement = task.task_type == "regenerate_interview_question"
    expected_subject = command.get("question_id") if replacement else str(question_set["id"])
    if str(row["subject_id"]) != expected_subject or row["subject_type"] != ("InterviewQuestion" if replacement else "InterviewQuestionSet"):
        return None
    if replacement:
        target = next((q for q in questions if str(q["id"]) == expected_subject), None)
        if not target or len(questions) != 5 or any(target[key] != command.get(key) for key in ("question_revision", "answer_revision")):
            return None
        peers = [q for q in questions if q != target]
        if {str(q["id"]): q["question_revision"] for q in peers} != command.get("peer_revisions"):
            return None
        sources.update(question_id=expected_subject, question_text=target["question_text"],
                       question_revision=target["question_revision"], answer_revision=target["answer_revision"],
                       other_questions=[q["question_text"] for q in peers])
    elif questions or question_set["number"] != command.get("set_number"):
        return None
    avoided = connection.execute("""
        SELECT id::text, question_text, origin, screened_fields FROM avoided_interview_questions
        WHERE user_id = %s ORDER BY created_at, id
    """, (task.user_id,)).fetchall()
    recent = [] if replacement else connection.execute("""
        SELECT q.id, q.question_text, q.question_revision, q.screened_fields, s.origin
        FROM interview_questions q JOIN interview_question_sets s ON s.id = q.interview_question_set_id
        WHERE s.user_id = %(owner)s AND s.set_type = %(type)s AND q.retired_at IS NULL
        ORDER BY s.created_at DESC, s.id DESC, q.position, q.id LIMIT 20
    """, {"owner": task.user_id, "type": question_set["set_type"]}).fetchall()
    sources["avoided_questions"] = [r["question_text"] for r in avoided]
    sources["avoided_question_sources"] = avoided
    sources["recent_questions"] = [r["question_text"] for r in recent]
    sources["question_sources"] = [
        {"question_id": str(q["id"]), "question_text": q["question_text"],
         "question_revision": q["question_revision"], "screened_fields": q["screened_fields"],
         "origin": question_set["origin"] if replacement else q["origin"]}
        for q in (questions if replacement else recent)
    ]
    return sources


def build_interview_question_reader(settings):
    """Keep all source reads in one repeatable read transaction per task."""
    def read(task):
        with open_read_only_connection(settings) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            return read_interview_question_sources(connection, task)
    return read
