# AGENTS.md — infra

## Purpose

Infrastructure as code and local dev infrastructure.

## Planned Layout

- `terraform/` — AWS: VPC, EC2, RDS (Postgres + pgvector), SQS, S3 (uploads bucket: Rails
  read/write, AI worker read-only), Route53, Lambda (scheduled jobs), ECR
- `compose/` — production Docker Compose file for the single EC2 server: `api`, `ai` workers,
  `web`, `landing`
- `elasticmq/` — local SQS emulator config (queues) used by docker compose
- `postgres/` — local Postgres init scripts (dev database, read-only `ai_reader` role)

## Local Rules

- One Terraform module per concern; no monolithic `main.tf`.
- No secrets in code; use variables plus AWS Secrets Manager / SSM.
- Do not add Kubernetes, a NAT gateway, or a load balancer without revisiting the
  [hosting decision](../docs/architecture.md); they make up most of the cost it avoids.
- Add nested instructions only for distinct operational constraints.

## Documentation

Explain non-obvious infrastructure constraints and operational side effects in comments.
Use short plain-English headers for handwritten infrastructure code following the root
guidance. Resource indexes are not required.

## Contents

Only local pieces exist so far: `elasticmq/`, `postgres/` and `compose.auth-review.yml`
(the isolated auth QA overlay used by
[Account rollout and human QA](../docs/operations/authentication-rollout.md)).
`terraform/` and `compose/` are not scaffolded yet.
