# AGENTS.md — services/ai/tests

## Purpose

pytest suite for the worker. Run with `docker compose run --rm ai pytest`.

## Contents

- `conftest.py` — disables Langfuse export and real model requests; `task_dependencies` fixture
- `fakes.py` — `FakeFileStorage`, `build_docx_bytes`
- `test_process_task_message.py` — per-message flow: parse, handle, publish result, delete rules
- `test_task_handlers.py` — dispatch and the parse_resume handler (agent on `TestModel`)
- `test_extract_document_text.py` — DOCX text extraction and unsupported files
- `test_resume_parsing_evaluators.py` — eval labels score 1.0; faithfulness catches invented text

## Local Rules

- Never call real SQS, S3, OpenAI, or Langfuse from tests; pass fakes and override agents
  with `TestModel`.
- Agent quality is measured by evals in `evals/`, not by pytest.
