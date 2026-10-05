"""
Description: Similarity search over the user's career library embeddings (written by Rails'
CareerLibrary::SyncLibraryEmbeddingsService). Scoped by the task's user id and by embedding
model, so vectors from another user or another model are never compared.
Index:
    - search_career_library: the library entries closest to a query vector, nearest first
"""

from collections.abc import Sequence
from uuid import UUID

import psycopg
from pgvector import Vector
from pgvector.psycopg import register_vector
from psycopg.rows import DictRow

from schemas.library_search_match import LibrarySearchMatch

# Iterative scans keep the HNSW index walking until `limit` rows pass the user filter, instead of
# filtering a fixed candidate list (which can return too few rows).
ITERATIVE_SCAN = "SET LOCAL hnsw.iterative_scan = strict_order"
SEARCH_QUERY = """
    SELECT source_type, source_id::text, content, embedding <=> %(query)s AS distance
    FROM library_embeddings
    WHERE user_id = %(user_id)s AND model = %(model)s
    ORDER BY embedding <=> %(query)s
    LIMIT %(limit)s
"""


def search_career_library(
    connection: psycopg.Connection[DictRow],
    user_id: UUID,
    query_embedding: Sequence[float],
    model: str,
    limit: int = 10,
) -> list[LibrarySearchMatch]:
    """Returns up to `limit` of the user's library entries embedded with `model` (the name Rails
    stores, e.g. "text-embedding-3-small"), ordered by cosine distance to the query vector."""
    register_vector(connection)
    params = {
        "user_id": user_id,
        "model": model,
        "query": Vector(list(query_embedding)),
        "limit": limit,
    }
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(ITERATIVE_SCAN)
        rows = cursor.execute(SEARCH_QUERY, params).fetchall()
    return [LibrarySearchMatch(**row) for row in rows]
