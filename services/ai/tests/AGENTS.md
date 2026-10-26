# AGENTS.md — services/ai/tests

## Purpose

pytest suite for the worker. Run with `docker compose run --rm ai pytest`.

## Contents

- `test_screening_recovery.py` — real sync/async screening and queued required-input tasks:
  timeout cancellation, fallback decisions, deadlines, limits, and per-model retry costs.
- `test_user_text_fallback_evals.py` — shared synthetic labels and outage handling through
  the dedicated boolean fallback evaluation runner.

- `test_conversation_logging_reliability.py` — nested/fallback calls, generations, redelivery,
  original publication errors, logging isolation and independent-process append integrity.
- `test_conversation_logging.py` — real task/model transcript capture, separate user/task
  files and untouched legacy logs, local gating, synthetic tool/retry parts, masked response and nonfatal disk errors.
- `test_conversation_logging_failures.py` — real validation recovery/exhaustion, prominent
  provider failures, repeated-history deduplication, privacy, nested/concurrent identities
  and nonfatal observation failures.
- `test_schema_dependencies.py` — schemas cannot import worker, agent, database, or evaluation implementation.

- `test_task_usage_accounting.py` — costs through task execution: run limits, SQS retries
  and output-validation failures.
- `test_task_usage_providers.py` — fallback, screening, query embeddings and unknown prices.
- `test_task_usage_guardrails.py` — composed pre-screen, capability guard and generation
  count once each, with cached tokens and no duplicate legacy aggregates.
- `offline_model_resolution` supplies fake providers through SDK model resolution; accounting
  tests must let production entry points install their own adapters.

- `test_library_search_scope.py` — rejects missing, empty, malformed, and unsupported type scopes.
- `test_library_embedding_search.py` — database-backed type/user/model filtering and hybrid ranking.
- `test_eval_reports.py` — offline comparison alignment, failure persistence, compatibility and model isolation.
- `test_eval_lifecycle.py` — native offline report retention, scores, metadata, output and failure flushing.
- `test_eval_report_costs.py` — native provider usage, cached costs, auxiliary calls and incomplete estimates.
- `test_eval_report_cost_edges.py` — validation retries, response model prices and absent usage.

- `test_prompt_guardrail.py` — real capability policy with fake providers: every generative
  agent blocks before a provider call, allowed flow, history coverage, caps and fail-closed.
  The `real_guardrail` marker opts out of the default fake capability classifier.
- `test_guardrail_task_results.py` — SQS results retain capability usage on success/block,
  preserve complete tailoring outcomes, and isolate usage between tasks.
- Non-database tests mock profile-contact loading to keep task tracing independent of Postgres.
- `conftest.py` — disables Logfire export and real model requests; `task_dependencies`,
  `fake_file_storage`, `fake_job_site`, `fake_context_reader` fixtures
- `test_interview_feedback_instructions.py` — FunctionModel captures actual requests to verify trusted scope selects exclusively subject-correction or personal-fact coaching policies.
- `fakes.py` — `FakeFileStorage`, `build_docx_bytes`, `FakeJobSite` (httpx.MockTransport),
  `build_gap_analysis_context`, `FakeGapAnalysisContextReader`
- `test_career_library_reader.py` — marked `db`: reads as `ai_reader` from the dev database
  (seeds inside a rolled-back transaction); order, content, and another user's job is not found
- `test_library_embedding_search.py` — marked `db`: searches as `ai_reader` (cosine order when
  the query text matches the nearest row, a keyword hit outranks a nearer vector, another
  user's and another model's embeddings never match)
- `test_hybrid_rank.py` — BM25, reciprocal rank fusion at k=60, and `hybrid_order`, with no
  database
- `test_embed_search_query.py` — query embedding on `TestEmbeddingModel`; stored model name
- `test_build_gap_analysis_prompt.py` — labels, date ranges, evidence lookup
- `test_find_gap_analysis_problems.py` — missing, repeated, unknown labels; met without
  evidence; labels leaked into prose (and label-like job terms allowed)
- `test_attach_evidence_text.py` — labels to library text, order, dedupe, unknown labels skipped
- `test_analyze_gaps_handler.py` — analyze_gaps end to end on `TestModel`, retry on a bad
  output (`FunctionModel`), deleted job / empty library / no requirements failures
- `test_gap_analysis_evaluators.py` — eval labels score 1.0
- `fixtures/linkedin/` — synthetic LinkedIn guest job pages (synthetic data only)
- `test_parse_linkedin_job_url.py` — LinkedIn job link forms, rejected URLs, site registry
- `test_linkedin_description_to_html.py` — `<br>` lines to paragraphs, bold headings split
- `test_split_description_sections.py` — heading classification, bullet filing, plain-text
  description
- `test_extract_job_posting.py` — headings vs sorting-agent fallback, bullet-number mapping
- `test_posting_from_parsed_job.py` — pasted-ad span checks and the posting builder
- `test_parse_job_posting_handler.py` — parse_job_posting with the screen and agent mocked
- `test_job_posting_parse_evaluators.py` — pasted-ad eval labels score 1.0
- `test_scrape_job_handler.py` — scrape_job end to end against a fake LinkedIn (sorting agent on
  `TestModel`), unsupported URLs, 404, unreadable page, 429/5xx/999 propagate
- `test_job_posting_extraction_evaluators.py` — eval labels score 1.0; heading-labelled cases
  pass without the agent; the verbatim check catches rewording
- `test_process_task_message.py` — per-message flow: parse, handle, publish result, delete rules,
  including a run cap that fails on the first attempt
- `test_polling_loop.py` — polling loop: deletes only handled tasks, delays kept ones, survives
  queue errors, stops
- `test_retryable_errors.py` — which model/AWS errors count as temporary. A run cap does not
- `test_run_limits.py` — settings caps, a request cap that never calls the model, an output-token
  cap, and a Jev cap that is not treated as unchecked
- `test_task_handlers.py` — dispatch and the parse_resume handler (agent on `TestModel`), incl.
  the resume fence, a blocked screen, and reported usage
- `test_import_privacy.py` — real local detector with fake screening/parsing providers,
  restoration before source checks, retry/fallback transcripts, duplicate/other-user
  isolation, detector failure, limits, late telemetry, and exception logging
- `test_model_prices.py` — cost math, unknown models, every configured model has a price
- `test_generative_model.py` — fallback is skipped when the names match, and a priced response
  model is what a resume parse bills
- `test_extract_document_text.py` — DOCX text extraction and unsupported files
- `test_resume_parsing_evaluators.py` — eval labels score 1.0; faithfulness catches invented text
- `test_enforce_source_faithfulness.py` — runtime guard drops rewritten highlights and invented
  skills, warns on unmatched names, leaves faithful parses unchanged
- `test_screen_user_text.py` — phrase block, missing key fails closed, yes-confidence threshold
- `test_check_section_output.py` — usable section shape and supplied labels;
  novel prose and empty citations are accepted
- `test_labeled_sources.py` — a section's own rows stay labeled when retrieval returned other rows
- `test_tailor_resume_handler.py` — copied contact/credentials, prompt failures, empty section
  skipping and completed output without section approval metadata
- `test_complete_resume_draft.py` — complete-draft ordering, preserved copied descriptions,
  sparse evidence, omissions, bounded writer overlap, awaited failure/deadline cancellation,
  request-level accounting, privacy, and transcript contexts
- `test_tailoring_evaluators.py` — hand labels score as expected
- `test_library_retrieval_evaluators.py` — retrieval eval labels score 1.0
- `test_job_relevance_ranker.py` — relevance ordering, ranking metrics, hard-negative guard,
  and empty-library fallback use fixed vectors without provider calls
- `test_user_text_screen_evaluators.py` — screen eval labels score 1.0; a yes under the 0.7
  bar does not count as a block
- `test_tracing.py` — exporter privacy after context exit, nested agent/embedding prompt versions,
  environment labels, numeric eval scores and bounded failure flushes
- `test_telemetry_flush.py` — blocked exporters respect caller deadlines; repeated calls
  share one background attempt without an unbounded queue
- `test_tracing_integration.py` — production task/configuration instrumentation, task identity,
  real synthetic Pydantic Evals cases and exception flushing
- `test_contact_mask.py` — known name, email, and phone become placeholders on a model
  request, a Logfire payload, and a search-query embedding; the model response is restored

## Local Rules

- Never call real SQS, S3, OpenAI, Logfire, or job sites from tests; pass fakes and override
  agents with `TestModel`.
- Only `db`-marked tests touch Postgres (the compose `db` service); they roll back everything
  they write. Skip them with `pytest -m "not db"`.
- Agent quality is measured by evals in `evals/`, not by pytest.

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.
`test_certifications.py` checks compatibility, citable evidence, retrieval, and copied identity.

Certification tests cover year/month/day precision, leap-month expiry boundaries, and
unknown expiration within partially stated periods.


- `test_interview_questions_handler.py` — generation/replacement, sparse/empty context, duplicate/excerpt/count checks, limits, and fail-closed notes. The database reader suite verifies job-independent ownership.

- `test_interview_feedback_handler.py` — feedback screening failures, sparse context, invalid
  output usage and illustrative paraphrasing, prompt cap, and excluded requirements/notes.
- `test_interview_task_contract.py` — feedback snapshot validation for blank and oversized answers.
- `test_interview_evaluators.py` — synthetic dataset loading and deterministic checks against
  valid output, duplicates, incorrect counts/categories, invented quotes and missing placeholders.
