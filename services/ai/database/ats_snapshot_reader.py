"""Read one owned immutable ATS run; workers never update the run or resume."""

from database.open_read_only_connection import open_read_only_connection
from schemas.ats_content import Snapshot


def build_ats_snapshot_reader(settings):
    """Return a reader scoped by both run identity and the task owner's user id."""

    def read(user_id, run_id):
        with open_read_only_connection(settings) as connection:
            row = connection.execute(
                "SELECT resume_id::text, content_snapshot, job_snapshot, content_fingerprint, job_fingerprint, rubric_version FROM ats_check_runs WHERE id = %(run_id)s AND user_id = %(user_id)s",
                {"run_id": run_id, "user_id": user_id},
            ).fetchone()
            return Snapshot.model_validate(row) if row else None

    return read
