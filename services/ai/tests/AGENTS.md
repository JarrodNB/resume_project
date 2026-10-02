# AGENTS.md — services/ai/tests

## Purpose

pytest suite for the worker. Run with `docker compose run --rm ai pytest`.

## Contents

- `conftest.py` — disables Langfuse export and real model requests; `task_dependencies` fixture
- `fakes.py` — `FakeFileStorage`, `build_docx_bytes`
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

- Never call real SQS, S3, OpenAI, or Langfuse from tests; pass fakes and override agents
  with `TestModel`.
- Agent quality is measured by evals in `evals/`, not by pytest.
