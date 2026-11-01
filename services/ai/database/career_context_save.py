"""Check a chat save against the owner's current career contexts without writing.

Only a status reaches the model; saved text stays in the database. Rails repeats
these checks under the owner lock when accepting the reply and proposal.
"""
from database.open_read_only_connection import open_read_only_connection


def check_career_context_save(connection, user_id, requirement, response):
    with connection.cursor() as cursor:
        row = cursor.execute("""
            SELECT EXISTS(SELECT 1 FROM career_contexts WHERE user_id = %(user_id)s
                          AND requirement = %(requirement)s) AS topic_exists,
                   EXISTS(SELECT 1 FROM career_contexts WHERE user_id = %(user_id)s
                          AND requirement = %(requirement)s AND response = %(response)s) AS exact_exists,
                   (SELECT count(*) FROM career_contexts WHERE user_id = %(user_id)s) AS total
        """, {"user_id": user_id, "requirement": requirement, "response": response}).fetchone()
    if row["exact_exists"]:
        return "already_saved"
    if row["topic_exists"]:
        return "conflict"
    return "full" if row["total"] >= 100 else "ready"


def build_context_save_check(settings):
    """Open a fresh read-only connection for each bounded proposal check."""
    def check(user_id, requirement, response):
        with open_read_only_connection(settings) as connection:
            connection.execute("SET LOCAL statement_timeout = '5s'")
            return check_career_context_save(connection, user_id, requirement, response)
    return check
