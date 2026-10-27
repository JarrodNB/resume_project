# AGENTS.md — services/ai/memory

## Purpose

Long-term memory retrieval helpers that aren't SQL: embedding search queries so they can be
compared with the career library embeddings Rails stores in `library_embeddings`.

## Contents

- `embed_search_query.py` — `embed_search_query(text, model, dimensions)`: embeds one query
  through Pydantic AI's `Embedder` (traced in Logfire via `Embedder.instrument_all()`). Known
  contact is replaced with the same placeholders Rails uses for library rows. Returns the
  vector and its token usage. Stored model-name conversion belongs to the database search
  interface; callers pass the configured model unchanged.
- `hybrid_rank.py` — `keyword_rank` (BM25), `reciprocal_rank_scores` (k=60), and `hybrid_order`.
  Library search and the library-retrieval eval both call `hybrid_order(documents, query_text)`
  with immutable `RankedDocument` records (ID, content, distance) in cosine order.
  The ranker owns projections for keyword ranking and tie-breaking; callers do not align separate maps.

## Local Rules

- Never call the OpenAI SDK directly; use Pydantic AI's `Embedder`.
- The model and dimensions come from `WorkerSettings.embedding_model` / `embedding_dimensions`
  and must match Rails' `CareerLibraryEmbeddings::MODEL` / `DIMENSIONS`. Searches filter by the
  stored model name, so a mismatch returns nothing rather than wrong neighbours.
- The SQL side of a search lives in `database/library_embedding_search.py`. It loads the user's
  rows in cosine order; `hybrid_order` fuses that with BM25. The user and model filters stay in
  SQL, before either rank.
- Tests use `TestEmbeddingModel`; `ALLOW_MODEL_REQUESTS = False` also blocks real embedding calls.

- `rerank_job_listings.py` — equal RRF (k=60) fuses career-library similarity order with
  BM25 over the submitted search keyword and listing excerpts. Returns only candidate IDs,
  keeping semantic/provider order on ties; no fit percentage or qualification inference.
