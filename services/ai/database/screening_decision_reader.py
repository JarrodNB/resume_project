"""Read successful classifier decisions for the task owner, without database writes.

Only exact digest/policy pairs are returned. Matching another user's content never grants
reuse, and Rails remains responsible for validating and applying success reports.
"""

from uuid import UUID

from database.open_read_only_connection import open_read_only_connection
from worker.settings import WorkerSettings


def read_screening_successes(connection, user_id: UUID, candidates) -> set[tuple[str, str]]:
    """Find exact requested approvals under the owner, using bounded lookup batches."""
    found = set()
    candidates = list(candidates)
    for offset in range(0, len(candidates), 1000):
        batch = candidates[offset:offset + 1000]
        rows = connection.execute(
            """SELECT content_digest, policy_identity FROM screening_decisions
               WHERE user_id = %(user_id)s
                 AND (content_digest, policy_identity) IN
                   (SELECT * FROM unnest(%(digests)s::text[], %(policies)s::text[]))""",
            {"user_id": user_id, "digests": [pair[0] for pair in batch],
             "policies": [pair[1] for pair in batch]},
        ).fetchall()
        found.update((row["content_digest"], row["policy_identity"]) for row in rows)
    return found


def build_database_screening_reader(settings: WorkerSettings):
    """Build the injectable owner-scoped, read-only worker lookup."""
    def read_from_database(user_id, candidates):
        with open_read_only_connection(settings) as connection:
            return read_screening_successes(connection, user_id, candidates)
    return read_from_database
