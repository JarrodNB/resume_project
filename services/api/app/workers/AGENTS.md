# AGENTS.md — services/api/app/workers

## Purpose

Shoryuken workers that consume SQS queues. They run in the `api-results-worker` compose
service (`bundle exec shoryuken -R -C config/shoryuken.yml`), not in Puma.

## Contents

- `ai_result_worker.rb` — consumes `ai_results`, delegates to `AiTasks::ApplyAiResultService`

## Local Rules

- Workers are thin: parse the body (`body_parser: :json`), call one service, raise if it fails.
- Use `auto_delete: true`, so a message is deleted only after `perform` succeeds. Raising
  leaves it for SQS to retry, and after 3 failed attempts it moves to the dead-letter queue.
- Handlers must be safe to run twice (SQS redelivers). Put the idempotency check in the service.
- New queues must also be added to `config/shoryuken.yml` and `infra/elasticmq/elasticmq.conf`.
