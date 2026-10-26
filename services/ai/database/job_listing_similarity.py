"""Compare candidate vectors with only one user's existing career-library vectors.

One read-only SQL query takes each listing's three nearest library entries and
averages their cosine similarities. Rails owns every stored vector and write.
"""

from collections.abc import Sequence
from uuid import UUID

from pgvector import Vector
from pgvector.psycopg import register_vector

from database.open_read_only_connection import open_read_only_connection
from screening.session import remaining_timeout

SIMILARITY_QUERY = """
WITH candidates AS (
    SELECT * FROM unnest(%(ids)s::text[], %(vectors)s::vector[])
      WITH ORDINALITY AS candidate(id, embedding, position)
)
SELECT candidates.id, AVG(1 - nearest.distance) AS similarity
FROM candidates
CROSS JOIN LATERAL (
    SELECT library.embedding <=> candidates.embedding AS distance
    FROM library_embeddings AS library
    WHERE library.user_id = %(user_id)s AND library.model = %(model)s
    ORDER BY library.embedding <=> candidates.embedding
    LIMIT 3
) AS nearest
GROUP BY candidates.id, candidates.position
ORDER BY candidates.position
"""


def score_job_listing_vectors(
    connection, user_id: UUID, candidates: Sequence[tuple[str, list[float]]], model: str
):
    """Return candidate IDs/similarities, or no rows when that user/model has no library."""
    if not candidates:
        return []
    register_vector(connection)
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("SET LOCAL hnsw.iterative_scan = strict_order")
        rows = cursor.execute(
            SIMILARITY_QUERY,
            {
                "ids": [item[0] for item in candidates],
                "vectors": [Vector(item[1]) for item in candidates],
                "user_id": user_id,
                "model": model.split(":", 1)[-1],
            },
        ).fetchall()
    return [(row["id"], float(row["similarity"])) for row in rows]


def build_job_listing_scorer(settings):
    """Open a bounded read-only connection for one reranking task's scoped comparison."""

    def score(user_id, candidates, model):
        remaining = remaining_timeout(settings.llm_run_timeout_seconds)
        bounded = settings.model_copy(
            update={
                "db_connect_timeout_seconds": max(
                    1,
                    min(
                        settings.db_connect_timeout_seconds,
                        int(remaining),
                    ),
                )
            }
        )
        with open_read_only_connection(bounded) as connection, connection.transaction():
            timeout_ms = max(1, int(remaining_timeout(settings.llm_run_timeout_seconds) * 1000))
            connection.execute(
                "SELECT set_config('statement_timeout', %s, true)", [str(timeout_ms)]
            )
            return score_job_listing_vectors(connection, user_id, candidates, model)

    return score
