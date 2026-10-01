# AGENTS.md — services/ai/worker

## Purpose

The worker process: polls SQS, dispatches each task to the right handler, publishes results.

## Contents

- `main.py` — entry point and polling loop (`python -m worker.main`)
- `settings.py` — environment-based configuration (`WorkerSettings`)
- `sqs_queue_client.py` — wrapper for one SQS queue (receive, delete, send)

## Local Rules

- Keep this package about queue plumbing and dispatch. Agent logic goes in `agents/`,
  tools in `tools/`, prompts in `prompts/` (sibling folders, created when first needed).
