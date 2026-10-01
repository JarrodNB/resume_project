# AGENTS.md — infra

## Purpose

Infrastructure as code and local dev infrastructure.

## Planned Layout

- `terraform/` — AWS: VPC, EKS, RDS (Postgres + pgvector), SQS, Route53, Lambda (scheduled jobs), ECR
- `k8s/` — Kubernetes manifests for `api`, `ai` workers, `web`, `landing`
- `elasticmq/` — local SQS emulator config (queues) used by docker compose
- `postgres/` — local Postgres init scripts (dev database, read-only `ai_reader` role)

## Local Rules

- One Terraform module per concern; no monolithic `main.tf`.
- No secrets in code; use variables plus AWS Secrets Manager / SSM.
- Each subfolder gets its own `AGENTS.md` when created.

## File Header Format

Every Terraform (`.tf`) and Kubernetes YAML file starts with:

```hcl
# Description: SQS queues for AI tasks and AI results, with dead-letter queues.
# Index:
#   - aws_sqs_queue.ai_tasks: tasks published by the Rails API
#   - aws_sqs_queue.ai_results: results published by the AI workers
```

## Contents

Not scaffolded yet.
