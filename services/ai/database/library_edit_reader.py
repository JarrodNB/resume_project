"""Load one owned target, generated review questions and ancestor command/fragments.

Commands contain identities, fingerprints and the newest user feedback only. Generated
fragments come from a narrow workflow view; arbitrary task/accounting data is never granted.
"""

from uuid import UUID

from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus

from database.library_review_reader import read_library_review
from database.open_read_only_connection import open_read_only_connection
from schemas.library_edit import LibraryEditInput, generated_edit_messages
from worker.legacy_career_context import normalize_legacy_career_context

EXCHANGE_QUERY = """
    SELECT id::text, task_type, status, input, result, message_history, pending_questions, accepted_at
    FROM ai_library_exchanges WHERE id = %(id)s AND user_id = %(user_id)s
"""
HIGHLIGHT_ROLE_QUERY = """
    SELECT experiences.id::text FROM experiences
    JOIN experience_highlights ON experience_highlights.experience_id = experiences.id
    WHERE experiences.user_id = %(user_id)s AND experience_highlights.id = %(id)s
"""
SECTIONS = {"experience": "experience", "experience_highlight": "experience", "user": "summary",
            "project": "projects", "career_context": "career_contexts"}


def read_library_edit(connection, task):
    """Resolve only an unbroken owned edit chain and unchanged selected source context."""
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction():
        def exchange(identity, task_type):
            row = connection.execute(EXCHANGE_QUERY, {"id": UUID(str(identity)), "user_id": task.user_id}).fetchone()
            if row is None or row["task_type"] != task_type:
                raise ValueError("Owned editing exchange unavailable")
            return row

        current = exchange(task.ai_task_id, "improve_library_entry")
        # task.input was normalized from legacy key spellings; compare like with like.
        command = normalize_legacy_career_context(current["input"])
        if current["status"] != "queued" or command != task.input:
            raise ValueError("Editing command is no longer current")
        target = command["target"]
        kind, identity = target["kind"], target["record_id"]
        section = SECTIONS.get(kind)
        if section is None or section != command["section"] or not 1 <= command["turn"] <= 8:
            raise ValueError("Unsupported editing target")
        role_id = identity if kind == "experience" else None
        if kind == "experience_highlight":
            row = connection.execute(HIGHLIGHT_ROLE_QUERY, {"id": UUID(identity), "user_id": task.user_id}).fetchone()
            if row is None:
                raise ValueError("Owned highlight unavailable")
            role_id = row["id"]
        if kind == "user" and identity != str(task.user_id):
            raise ValueError("Foreign summary")
        projection = read_library_review(connection, task.user_id, section,
                                         record_id=identity, experience_id=role_id)
        selected = next((item for item in projection.targets if item.kind == kind and item.record_id == identity), None)
        if selected is None or selected.model_dump() != target:
            raise ValueError("Editing source changed")

        chain = [current]
        while chain[-1]["input"].get("previous_task_id"):
            child = chain[-1]
            parent = exchange(child["input"]["previous_task_id"], "improve_library_entry")
            if (len(chain) >= 8 or parent["input"].get("root_id") != command["root_id"]
                    or parent["input"]["target"] != target
                    or parent["input"]["turn"] != child["input"]["turn"] - 1
                    or parent["status"] == "queued" or parent["accepted_at"] is not None):
                raise ValueError("Invalid editing parent")
            chain.append(parent)
        root = chain[-1]
        if root["id"] != command["root_id"] or root["input"]["turn"] != 1 or len(chain) != command["turn"]:
            raise ValueError("Invalid editing root")
        question_id = command.get("question_id")
        if question_id:
            # A failed attempt retains a deferred call owned by the nearest paused ancestor.
            paused = next((item for item in chain[1:] if item["status"] == "needs_user_input"), None)
            if paused is None or not any(item.get("id") == question_id for item in paused["pending_questions"]):
                raise ValueError("Deferred question is not owned by this exchange")
        review = root["input"].get("review_question")
        if review:
            saved = exchange(review["review_task_id"], "review_library_section")
            if saved["status"] != "completed":
                raise ValueError("Generated review is unavailable")
            assessment = next((item for item in (saved["result"] or {}).get("assessments", [])
                               if all(item.get(key) == target[key] for key in ("kind", "record_id", "field", "source_digest"))), None)
            if assessment is None:
                raise ValueError("Generated question target changed")
            questions = assessment.get("questions", [assessment["question"]] if assessment.get("question") else [])
            pairs = review.get("answers") or [{"question_index": 0, "answer": root["input"]["feedback"]}]
            if not pairs or len(pairs) > 3 or len({item["question_index"] for item in pairs}) != len(pairs):
                raise ValueError("Invalid saved review answers")
            answers = []
            for pair in pairs:
                index = pair["question_index"]
                if not isinstance(index, int) or not 0 <= index < len(questions):
                    raise ValueError("Generated question is unavailable")
                answers.append({"question_index": index, "question": questions[index], "answer": pair["answer"]})
            review = {"review_task_id": review["review_task_id"], "answers": answers}
        turns = []
        generated = []
        for ancestor in reversed(chain[1:]):
            if ancestor["status"] not in ("completed", "needs_user_input"):
                continue
            raw = ancestor["message_history"] or []
            fragment = generated_edit_messages(raw)
            # Old workers persisted cumulative history. Ignore copied user requests and
            # subtract only the exact generated prefix already represented by ancestors.
            legacy = any(part.get("part_kind") == "user-prompt"
                         for message in raw for part in message.get("parts", []))
            if legacy:
                if fragment[:len(generated)] != generated:
                    raise ValueError("Legacy editing history changed")
                fragment = fragment[len(generated):]
            if not fragment:
                continue
            generated.extend(fragment)
            feedback = ancestor["input"].get("feedback", "")
            if review and not turns and ancestor["id"] == root["id"]:
                feedback = ""
            turns.append({"feedback": feedback, "skip": ancestor["input"].get("skip", False),
                          "question_id": ancestor["input"].get("question_id"), "history": fragment})
        return LibraryEditInput(section=section, library=projection.library, target=selected,
                                feedback="" if review and len(chain) == 1 else command.get("feedback", ""),
                                skip=command.get("skip", False),
                                turn=command["turn"], previous_task_id=command.get("previous_task_id"),
                                question_id=question_id, turns=turns, review_question=review)


def build_database_edit_reader(settings):
    def read(task):
        with open_read_only_connection(settings) as connection:
            return read_library_edit(connection, task)
    return read
