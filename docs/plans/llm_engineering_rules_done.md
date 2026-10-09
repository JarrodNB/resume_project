# LLM engineering rules already applied

These bullets from `.cursor/rules/llm_engineering.mdc` are already in the AI worker. Do not implement them again. Pick a different unmet bullet for the next pass.

Decisions also live in `docs/architecture.md` under "Decisions".

## Pin model names (no floating "latest")

The Jev screen default is `typesafe:jev-1.13.0` in `services/ai/worker/settings.py` (`user_text_screen_model`). It is not `typesafe:jev-latest`.

The price table in `services/ai/worker/model_prices.py` still prices `typesafe:jev-latest` and `jev-1.13.0`, so an old environment override or the id the API reports is not recorded as free. Jev has no generative fallback: a missing key or a failed call fails closed.

## Version every prompt, and record the version and environment on the trace

Each prompt module has a version constant. Bump that constant when the instructions change (`services/ai/prompts/AGENTS.md`).

| Prompt | Constant | Version |
| --- | --- | --- |
| Resume parsing | `RESUME_PARSING_PROMPT_VERSION` | `"1"` |
| Requirements sorting | `JOB_REQUIREMENTS_SORTING_PROMPT_VERSION` | `"1"` |
| Pasted job ad | `PARSE_JOB_POSTING_PROMPT_VERSION` | `"2"` |
| Gap analysis | `GAP_ANALYSIS_PROMPT_VERSION` | `"1"` |
| Tailoring | `RESUME_TAILORING_PROMPT_VERSION` | `"1"` |
| User-text screen | `USER_TEXT_SCREEN_PROMPT_VERSION` | `"1"` |

`record_prompt_version` in `services/ai/worker/tracing.py` calls Langfuse `propagate_attributes(version=...)`. Every agent wraps its `run` in that context manager, so the version sits on that call's spans. A task can screen text and then generate, so the version is not one string for the whole task.

Each eval runner passes the same `version` and puts `prompt_version` in the trace metadata.

`LANGFUSE_TRACING_ENVIRONMENT=development` is set on the `ai` service in `docker-compose.yml` and documented in `services/ai/.env.example`. `Langfuse()` reads it at startup. Model, token counts, and latency still come from Pydantic AI's OpenTelemetry spans. Cost is reported on the task result, not as a separate trace field.

## Fallback model for outages and rate limits

`generative_fallback_model` in `WorkerSettings` defaults to `openai:gpt-5-nano` (already in `MODEL_PRICES`).

`generative_model` in `services/ai/worker/generative_model.py` returns a Pydantic AI `FallbackModel(primary, fallback)`. It returns the primary alone when the two names match, so one model is not called twice. `FallbackModel` switches on `ModelAPIError` (rate limit, 5xx, connection error). Output-validation retries stay on the primary.

The five OpenAI runs take `fallback_model`: resume parsing, pasted-ad parse, bullet sorting, gap analysis, and tailoring. The Jev screen does not.

Handlers bill `reported_model_name` (`services/ai/worker/model_prices.py`): the response's model name when that name has a price, otherwise the configured primary. `JobPostingExtraction.sorting_model` carries the billed name when the sorting agent ran.

## Hybrid search

`search_career_library` loads the user's rows for the stored embedding model in cosine order, then `hybrid_order` in `services/ai/memory/hybrid_rank.py` fuses that list with BM25 over the same texts. Reciprocal rank fusion uses k=60. Ties break toward the smaller cosine distance. Tailoring calls this once per written section (`retrieve_for_section`).

The user id and model filters stay in the SQL, before either rank.

The library-retrieval eval ranks with the same `hybrid_order` and scores recall@k, precision@k, and MRR (`k` is the production limit). `tests/test_hybrid_rank.py` is the deterministic golden check: an exact term outranks a nearer row, a query with no shared term leaves cosine order alone, and k=60 prefers a row both lists rank well. k=1 does not, which is why 60 is the constant.

## Still open

These were left on purpose. They are the ones to pick next, not the ones above.

- An MCP tool layer. The agents have no tools yet.
- Pseudonymized trace user ids. Traces tag the real `user_id` on purpose so a task can be followed end to end.
