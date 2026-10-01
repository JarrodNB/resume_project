# AGENTS.md — services/ai/tests

## Purpose

pytest suite for the worker. Run with `docker compose run --rm ai pytest`.

## Contents

- `test_process_task_message.py` — per-message flow: parse, handle, publish result, delete rules

## Local Rules

- Never call real SQS or OpenAI from tests; pass fakes (see `FakeResultQueue`).
- Agent quality is measured by evals in `evals/`, not by pytest.
