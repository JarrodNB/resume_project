# AGENTS.md — services/ai/tests

## Purpose

pytest suite for the worker. Run with `docker compose run --rm ai pytest`.

## Contents

- `conftest.py` — disables Langfuse export and real model requests; `task_dependencies`,
  `fake_file_storage`, `fake_job_site`, `fake_context_reader` fixtures
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
- `fixtures/linkedin/` — synthetic LinkedIn guest job pages (see `fixtures/AGENTS.md`)
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
- `test_process_task_message.py` — per-message flow: parse, handle, publish result, delete rules
- `test_polling_loop.py` — polling loop: deletes only handled tasks, delays kept ones, survives
  queue errors, stops
- `test_retryable_errors.py` — which model/AWS errors count as temporary
- `test_task_handlers.py` — dispatch and the parse_resume handler (agent on `TestModel`), incl.
  the resume fence, a blocked screen, and reported usage
- `test_model_prices.py` — cost math, unknown models, every configured model has a price
- `test_generative_model.py` — fallback is skipped when the names match, and a priced response
  model is what a resume parse bills
- `test_extract_document_text.py` — DOCX text extraction and unsupported files
- `test_resume_parsing_evaluators.py` — eval labels score 1.0; faithfulness catches invented text
- `test_enforce_source_faithfulness.py` — runtime guard drops rewritten highlights and invented
  skills, warns on unmatched names, leaves faithful parses unchanged
- `test_screen_user_text.py` — phrase block, missing key fails closed, yes-confidence threshold
- `test_check_section_faithfulness.py` — unsupported claims are rejected; library text is not
  substituted
- `test_labeled_sources.py` — a section's own rows stay labeled when retrieval returned other rows
- `test_tailor_resume_handler.py` — one section per message, blocked edit, omit, an empty
  projects list is skipped with no model call, generation
- `test_tailoring_evaluators.py` — hand labels score as expected
- `test_library_retrieval_evaluators.py` — retrieval eval labels score 1.0
- `test_user_text_screen_evaluators.py` — screen eval labels score 1.0; a yes under the 0.7
  bar does not count as a block
- `test_contact_mask.py` — known name, email, and phone become placeholders on a model
  request, a Langfuse payload, and a search-query embedding; the model response is restored

## Local Rules

- Never call real SQS, S3, OpenAI, Langfuse, or job sites from tests; pass fakes and override
  agents with `TestModel`.
- Only `db`-marked tests touch Postgres (the compose `db` service); they roll back everything
  they write. Skip them with `pytest -m "not db"`.
- Agent quality is measured by evals in `evals/`, not by pytest.
