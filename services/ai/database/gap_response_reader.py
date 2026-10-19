"""Read saved job answers for matching tailoring snapshots, scoped to their owner.

Only matching revisions receive private screening state. Older queue snapshots remain
usable as temporary sources and can never approve a different saved version.
"""

import json
from datetime import UTC, datetime

from database.open_read_only_connection import open_read_only_connection
from schemas.record_screening import RecordScreeningState


class GapResponseSnapshot(dict):
    """Prompt values with reader-owned provenance outside the dictionary payload."""

    _screening_state: RecordScreeningState | None = None


def match_gap_response_snapshots(snapshots, rows):
    """Attach state only when ID, revision and both text fields match the owned row."""
    by_id = {str(row["id"]): row for row in rows}
    result = []
    for snapshot in snapshots:
        value = GapResponseSnapshot({key: snapshot.get(key, "") for key in ("requirement", "body")})
        row = by_id.get(snapshot.get("id"))
        try:
            revision = datetime.fromisoformat(snapshot.get("updated_at", ""))
        except (ValueError, TypeError):
            revision = None
        if row is not None:
            updated = row["updated_at"]
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=UTC)
            if revision == updated and all(value[key] == row[key] for key in value):
                value._screening_state = RecordScreeningState(
                    "JobGapResponse", str(row["id"]), updated, row["screened_at"],
                    row["screening_policy_version"], json.dumps(value, separators=(",", ":"), ensure_ascii=False),
                )
        result.append(value)
    return result


def read_gap_response_snapshots(connection, user_id, job_id, snapshots):
    """Read only answers for the task user's job, then match the queued revision."""
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT responses.id, responses.requirement, responses.body,
                   responses.updated_at, responses.screened_at, responses.screening_policy_version
            FROM job_gap_responses responses JOIN jobs ON jobs.id = responses.job_id
            WHERE jobs.user_id = %(user_id)s AND jobs.id = %(job_id)s
            """, {"user_id": user_id, "job_id": job_id})
        return match_gap_response_snapshots(snapshots, cursor.fetchall())


def build_gap_response_snapshot_reader(settings):
    """Build the production reader using one read-only connection per task."""
    def read(user_id, job_id, snapshots):
        with open_read_only_connection(settings) as connection:
            return read_gap_response_snapshots(connection, user_id, job_id, snapshots)
    return read
