# AGENTS.md — services/ai/tests

## Purpose

pytest suite for the worker. Run with `docker compose run --rm ai pytest`.

## Contents

- `conftest.py` — disables Langfuse export and real model requests; `task_dependencies`,
  `fake_file_storage`, `fake_job_site` fixtures
- `fakes.py` — `FakeFileStorage`, `build_docx_bytes`, `FakeJobSite` (httpx.MockTransport)
- `fixtures/linkedin/` — synthetic LinkedIn guest job pages (see `fixtures/AGENTS.md`)
- `test_parse_linkedin_job_url.py` — LinkedIn job link forms, rejected URLs, site registry
- `test_linkedin_description_to_html.py` — `<br>` lines to paragraphs, bold headings split
- `test_split_description_sections.py` — heading classification, bullet filing, plain-text
  description
- `test_extract_job_posting.py` — headings vs sorting-agent fallback, bullet-number mapping
- `test_scrape_job_handler.py` — scrape_job end to end against a fake LinkedIn (sorting agent on
  `TestModel`), unsupported URLs, 404, unreadable page, 429/5xx/999 propagate
- `test_job_posting_extraction_evaluators.py` — eval labels score 1.0; heading-labelled cases
  pass without the agent; the verbatim check catches rewording
- `test_process_task_message.py` — per-message flow: parse, handle, publish result, delete rules
- `test_polling_loop.py` — polling loop: deletes only handled tasks, delays kept ones, survives
  queue errors, stops
- `test_retryable_errors.py` — which model/AWS errors count as temporary
- `test_task_handlers.py` — dispatch and the parse_resume handler (agent on `TestModel`), incl.
  reported usage
- `test_model_prices.py` — cost math, unknown models, every configured model has a price
- `test_extract_document_text.py` — DOCX text extraction and unsupported files
- `test_resume_parsing_evaluators.py` — eval labels score 1.0; faithfulness catches invented text
- `test_enforce_source_faithfulness.py` — runtime guard drops rewritten highlights and invented
  skills, warns on unmatched names, leaves faithful parses unchanged

## Local Rules

- Never call real SQS, S3, OpenAI, Langfuse, or job sites from tests; pass fakes and override
  agents with `TestModel`.
- Agent quality is measured by evals in `evals/`, not by pytest.
