# AGENTS.md — infra

## Purpose

Infrastructure as code and local dev infrastructure.

## Planned Layout

- `terraform/` — AWS: VPC, EKS, RDS (Postgres + pgvector), SQS, S3 (uploads bucket: Rails
  read/write, AI worker read-only), Route53, Lambda (scheduled jobs), ECR
- `k8s/` — Kubernetes manifests for `api`, `ai` workers, `web`, `landing`
- `elasticmq/` — local SQS emulator config (queues) used by docker compose
- `postgres/` — local Postgres init scripts (dev database, read-only `ai_reader` role)

## Local Rules

- One Terraform module per concern; no monolithic `main.tf`.
- No secrets in code; use variables plus AWS Secrets Manager / SSM.
- Add nested instructions only for distinct operational constraints.

## Documentation

Explain non-obvious infrastructure constraints and operational side effects in comments.
Routine description headers and resource indexes are not required.

## Contents

Not scaffolded yet.
