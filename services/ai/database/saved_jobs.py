"""Read only an owner's active saved job labels, with a sentinel row for overflow.

Rails owns all writes. SQL filters the owner before applying stable newest-first order.
"""
from database.open_read_only_connection import open_read_only_connection


def read_saved_jobs(connection, user_id):
    """Read at most 501 rows so callers can reject lists exceeding the 500-job cap."""
    return connection.execute("""
        SELECT id::text, title, company, screened_fields FROM jobs
        WHERE user_id = %(user_id)s AND archived_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 501
    """, {"user_id": user_id}).fetchall()


def build_database_saved_jobs_reader(settings):
    """Open a fresh read-only connection for each authenticated list request."""
    def read(user_id):
        with open_read_only_connection(settings) as connection:
            return read_saved_jobs(connection, user_id)
    return read
