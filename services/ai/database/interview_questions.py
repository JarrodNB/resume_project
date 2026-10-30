"""Load saved written-practice sources after checking the durable task and its owner.

Commands carry identities and revisions. Source text stays in its domain tables; even
retained commands use current owned records and fail when their saved fences changed.
"""
from database.open_read_only_connection import open_read_only_connection


def read_interview_question_sources(connection, task):
    """Return prompt sources for an eligible queued task, otherwise no paid work."""
    row = connection.execute("""
        SELECT input, subject_id, subject_type FROM ai_tasks
        WHERE id = %(task)s AND user_id = %(owner)s AND task_type = %(kind)s AND status = 'queued'
    """, {"task": task.ai_task_id, "owner": task.user_id, "kind": task.task_type}).fetchone()
    if not row or task.task_type not in {"generate_interview_questions", "regenerate_interview_question"}:
        return None
    command = row["input"]
    if command.get("source_version") not in {None, 1}:
        return None
    question_set = connection.execute("""
        SELECT id, number, set_type FROM interview_question_sets
        WHERE id = %(set)s AND user_id = %(owner)s
    """, {"set": command.get("question_set_id"), "owner": task.user_id}).fetchone()
    if not question_set or question_set["set_type"] != command.get("set_type", "general"):
        return None
    questions = connection.execute("""
        SELECT q.id, q.question_text, q.question_revision, q.answer_revision
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
        if command.get("source_version") == 1:
            if {str(q["id"]): q["question_revision"] for q in peers} != command.get("peer_revisions"):
                return None
        elif (target["question_text"] != command.get("question_text") or
              sorted(q["question_text"] for q in peers) != sorted(command.get("other_questions", []))):
            return None
        if command.get("source_version") is None and command.get("other_question_snapshots"):
            saved_peers = {q.get("question_id"): q.get("question_revision") for q in command["other_question_snapshots"] if isinstance(q, dict)}
            if saved_peers != {str(q["id"]): q["question_revision"] for q in peers}:
                return None
        sources.update(question_id=expected_subject, question_text=target["question_text"],
                       question_revision=target["question_revision"], answer_revision=target["answer_revision"],
                       other_questions=[q["question_text"] for q in peers])
    elif questions or question_set["number"] != command.get("set_number", question_set["number"]):
        return None
    sources["avoided_questions"] = [r["question_text"] for r in connection.execute("""
        SELECT question_text FROM avoided_interview_questions WHERE user_id = %s ORDER BY created_at, id
    """, (task.user_id,)).fetchall()]
    sources["recent_questions"] = [] if replacement else [r["question_text"] for r in connection.execute("""
        SELECT q.question_text FROM interview_questions q
        JOIN interview_question_sets s ON s.id = q.interview_question_set_id
        WHERE s.user_id = %(owner)s AND s.set_type = %(type)s AND q.retired_at IS NULL
        ORDER BY s.created_at DESC, s.id DESC, q.position, q.id LIMIT 20
    """, {"owner": task.user_id, "type": question_set["set_type"]}).fetchall()]
    return sources


def build_interview_question_reader(settings):
    """Keep all source reads in one repeatable read transaction per task."""
    def read(task):
        with open_read_only_connection(settings) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            return read_interview_question_sources(connection, task)
    return read
