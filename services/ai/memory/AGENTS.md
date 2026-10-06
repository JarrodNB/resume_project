# AGENTS.md — services/ai/memory

## Purpose

Long-term memory retrieval helpers that aren't SQL: embedding search queries so they can be
compared with the career library embeddings Rails stores in `library_embeddings`.

## Contents

- `embed_search_query.py` — `embed_search_query(text, model, dimensions)`: embeds one query
  through Pydantic AI's `Embedder` (traced in Langfuse via `Embedder.instrument_all()`). Known
  contact is replaced with the same placeholders Rails uses for library rows. Returns the
  vector and its token usage. `stored_embedding_model_name(model)`: the worker's
  `openai:`-prefixed model name as Rails stores it (`text-embedding-3-small`)

## Local Rules

- Never call the OpenAI SDK directly; use Pydantic AI's `Embedder`.
- The model and dimensions come from `WorkerSettings.embedding_model` / `embedding_dimensions`
  and must match Rails' `CareerLibraryEmbeddings::MODEL` / `DIMENSIONS`. Searches filter by the
  stored model name, so a mismatch returns nothing rather than wrong neighbours.
- The SQL side of a search lives in `database/library_embedding_search.py`.
- Tests use `TestEmbeddingModel`; `ALLOW_MODEL_REQUESTS = False` also blocks real embedding calls.
