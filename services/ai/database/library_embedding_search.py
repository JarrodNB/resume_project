"""
Description: Hybrid search over the user's career library embeddings (written by Rails'
CareerLibrary::SyncLibraryEmbeddingsService). Scoped by the task's user id and by embedding
model and explicitly selected source types. Cosine order from
pgvector is fused with BM25 over the same rows (memory/hybrid_rank.py).
Index:
    - search_career_library: the library entries that best match a query, best first
"""

from collections.abc import Sequence
from collections.abc import Set as AbstractSet
from uuid import UUID

import psycopg
from pgvector import Vector
from pgvector.psycopg import register_vector
from psycopg.rows import DictRow

from memory.hybrid_rank import RankedDocument, hybrid_order
from schemas.library_search_match import LibrarySearchMatch

_SOURCE_TYPES = frozenset(
    {
        "Experience",
        "ExperienceHighlight",
        "Project",
        "Education",
        "Certification",
        "Skill",
        "LibraryFact",
    }
)

# Iterative scans keep the HNSW index walking until every row that passes the user filter is
# ordered, instead of filtering a fixed candidate list (which can drop a keyword match).
ITERATIVE_SCAN = "SET LOCAL hnsw.iterative_scan = strict_order"
SEARCH_QUERY = """
    SELECT source_type, source_id::text, content, embedding <=> %(query)s AS distance
    FROM library_embeddings
    WHERE user_id = %(user_id)s AND model = %(model)s
      AND source_type = ANY(%(source_types)s)
    ORDER BY embedding <=> %(query)s
"""


def search_career_library(
    connection: psycopg.Connection[DictRow],
    user_id: UUID,
    query_embedding: Sequence[float],
    query_text: str,
    model: str,
    limit: int = 10,
    *,
    source_types: AbstractSet[str],
) -> list[LibrarySearchMatch]:
    """Returns up to `limit` of the user's library entries embedded with `model` (the name Rails
    stores, e.g. "text-embedding-3-small"). Order is reciprocal rank fusion of cosine distance
    and BM25 on `query_text`; a higher score is a better match. Source types must be an
    explicit nonempty set of supported library types; invalid scopes raise ValueError."""
    if (
        not isinstance(source_types, AbstractSet)
        or not source_types
        or not source_types <= _SOURCE_TYPES
    ):
        raise ValueError("source_types must be a nonempty set of supported career-library types")
    register_vector(connection)
    params = {
        "user_id": user_id,
        "model": model,
        "source_types": sorted(source_types),
        "query": Vector(list(query_embedding)),
    }
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(ITERATIVE_SCAN)
        rows = cursor.execute(SEARCH_QUERY, params).fetchall()
    if not rows:
        return []
    documents = [
        RankedDocument(_row_id(row["source_type"], row["source_id"]), row["content"], float(row["distance"]))
        for row in rows
    ]
    ordered = hybrid_order(documents, query_text)[:limit]
    by_id = {document.id: row for document, row in zip(documents, rows, strict=True)}
    return [
        LibrarySearchMatch(
            source_type=by_id[item]["source_type"],
            source_id=by_id[item]["source_id"],
            content=by_id[item]["content"],
            distance=float(by_id[item]["distance"]),
            score=score,
        )
        for item, score in ordered
    ]


def _row_id(source_type: str, source_id: str) -> str:
    """One id for a library row. source_id alone can collide across entry kinds."""
    return f"{source_type}\n{source_id}"
