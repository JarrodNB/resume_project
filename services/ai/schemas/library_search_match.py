"""
Description: One career library entry returned by hybrid search over library_embeddings
(database/library_embedding_search.py). Read from the database; not an LLM output.
Index:
    - LibrarySearchMatch: the entry's kind and id, its embedded text, its cosine distance,
      and its fusion score
"""

from pydantic import BaseModel


class LibrarySearchMatch(BaseModel):
    """A library entry matched to the search query. `score` is the reciprocal-rank-fusion
    score (higher is a better match). `distance` is cosine distance (lower is nearer) and
    breaks ties."""

    source_type: str
    source_id: str
    content: str
    distance: float
    score: float
