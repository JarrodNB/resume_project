# AGENTS.md — infra/elasticmq

## Purpose

Local SQS emulator config. ElasticMQ speaks the SQS API, so services use the normal AWS
SDKs pointed at `http://sqs:9324` (inside compose) or `http://localhost:9324` (from the host).

## Contents

- `elasticmq.conf` — queue definitions (`ai_tasks`, `ai_results`, and their dead-letter queues)

## Local Rules

- Queue names and settings here must match the Terraform SQS definitions used in AWS.
- The `ai_tasks` dead-letter `maxReceiveCount` must equal the AI worker's `MAX_TASK_ATTEMPTS`
  (default 3), or tasks can be dead-lettered without a `failed` result.
- Restart the `sqs` container after changing this file: `docker compose restart sqs`.
