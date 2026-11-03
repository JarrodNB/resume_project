"""Read only an owner's active saved job labels, with a sentinel row for overflow.

Rails owns all writes. SQL filters the owner before applying stable newest-first order.
"""
from database.open_read_only_connection import open_read_only_connection


def read_saved_jobs(connection, user_id, *, limit=501):
    """Read newest active labels; the default includes a sentinel for the tool cap."""
    if not 1 <= limit <= 501:
        raise ValueError("Saved job limit must be between 1 and 501")
    return connection.execute("""
        SELECT id::text, title, company, screened_fields FROM jobs
        WHERE user_id = %(user_id)s AND archived_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT %(limit)s
    """, {"user_id": user_id, "limit": limit}).fetchall()


def build_database_saved_jobs_reader(settings):
    """Open a fresh read-only connection for each authenticated list request."""
    def read(user_id):
        with open_read_only_connection(settings) as connection:
            return read_saved_jobs(connection, user_id)
    return read


def read_job_summary(connection, user_id, job_id):
    """Read current posting facts only if the selected job is still owned and active."""
    return connection.execute("""
        SELECT id::text, title, company, location, requirements, responsibilities,
               nice_to_haves, screened_fields FROM jobs
        WHERE user_id = %(user_id)s AND id = %(job_id)s AND archived_at IS NULL
    """, {"user_id": user_id, "job_id": job_id}).fetchone()


def build_database_job_summary_reader(settings):
    """Open a fresh read-only connection for each selected posting request."""
    def read(user_id, job_id):
        with open_read_only_connection(settings) as connection:
            return read_job_summary(connection, user_id, job_id)
    return read
