"""Read the user's active saved practice questions for chat's question tools.

Only the token user's active slots (not retired copies). The list reads newest practice
set first and then by slot, without answers or feedback text: SQL returns whether an
answer and feedback exist, plus the revisions that decide whether the feedback is current.
One extra row (501 by default) lets the list detect a list over its 500-question cap.
The single-question read adds the saved answer (already rendered in its selected format),
the format and the saved feedback; it never reads answer drafts. Rails owns every write.
"""
from database.open_read_only_connection import open_read_only_connection


def read_interview_question_bank(connection, user_id, *, limit=501):
    """Read owned active questions with set labels and answer/feedback status fields."""
    if not 1 <= limit <= 501:
        raise ValueError("Interview question limit must be between 1 and 501")
    return connection.execute(r"""
        SELECT q.id::text, s.number AS set_number, s.set_type, q.position, q.question_text,
               q.question_revision, q.answer_revision, q.answer_format_revision,
               q.answer_text ~ '\S' AS answered, q.feedback <> '{}'::jsonb AS has_feedback,
               q.feedback_question_revision, q.feedback_answer_revision, q.screened_fields
        FROM interview_questions q
        JOIN interview_question_sets s ON s.id = q.interview_question_set_id
        WHERE s.user_id = %(user_id)s AND q.retired_at IS NULL
        ORDER BY s.created_at DESC, s.id DESC, q.position, q.id LIMIT %(limit)s
    """, {"user_id": user_id, "limit": limit}).fetchall()


def read_interview_question(connection, user_id, question_id):
    """Read one owned active question with its answer and feedback, or None when unavailable."""
    return connection.execute("""
        SELECT q.id::text, s.number AS set_number, s.set_type, q.position, q.question_text,
               q.answer_text, q.answer_format, q.question_revision, q.answer_revision,
               q.answer_format_revision, q.feedback, q.feedback <> '{}'::jsonb AS has_feedback,
               q.feedback_question_revision, q.feedback_answer_revision, q.screened_fields
        FROM interview_questions q
        JOIN interview_question_sets s ON s.id = q.interview_question_set_id
        WHERE s.user_id = %(user_id)s AND q.id = %(question_id)s AND q.retired_at IS NULL
    """, {"user_id": user_id, "question_id": question_id}).fetchone()


def build_database_interview_question_bank_reader(settings):
    """Open a fresh read-only connection for each authenticated list request."""
    def read(user_id):
        with open_read_only_connection(settings) as connection:
            return read_interview_question_bank(connection, user_id)
    return read


def build_database_interview_question_reader(settings):
    """Open a fresh read-only connection for each authenticated single-question read."""
    def read(user_id, question_id):
        with open_read_only_connection(settings) as connection:
            return read_interview_question(connection, user_id, question_id)
    return read
