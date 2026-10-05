"""
Description: One career library entry returned by a similarity search over library_embeddings
(database/library_embedding_search.py). Read from the database; not an LLM output.
Index:
    - LibrarySearchMatch: the entry's kind and id, its embedded text, and its cosine distance
"""

from pydantic import BaseModel


class LibrarySearchMatch(BaseModel):
    """A library entry close to the search query (smaller distance means more similar)."""

    source_type: str
    source_id: str
    content: str
    distance: float
