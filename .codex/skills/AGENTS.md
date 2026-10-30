# AGENTS.md — Codex Skills

## Purpose

Reusable, repository-scoped workflows for Codex.

Skills are discoverable through `.agents/skills`, a symlink to this directory.
Follow [cloud-runtime.md](cloud-runtime.md) for native cloud and local Docker execution.

## Contents

- `codebase-design/` — Upstream Matt Pocock deep-module design skill and supporting references.
- `domain-modeling/` — Upstream Matt Pocock domain-modeling skill and glossary/ADR formats.
- `grilling/` — Upstream Matt Pocock skill for questioning plans, decisions, and ideas.
- `fix-loop/` — Bounded autonomous fixes, each in a fresh worktree with its own PR.
- `super-loop/` — Per-category loop quotas and the shared delivery protocol used by companion loops.
  The protocol routes supporting skills and reuses orchestrator's Ponytail guidance for
  implementations and fresh reviews; fix-loop follows the same supporting guidance.
- Companion delivery loops: `test-quality-loop/`, `simplify-loop/`, `resilience-loop/`,
  `performance-loop/`, `accessibility-loop/`, `ux-friction-loop/`, `docs-drift-loop/`,
  `observability-loop/`, `dependency-loop/`, `boundary-loop/`, and `architecture-loop/`.
  Architecture iterations require a user decision on the proposed design before implementation.
- `orchestrator/` — Local delivery planning, approvals, delegation, and handoff.
- `pr-review-environment/` — Isolated local PR stacks with copies of the main development database and existing accounts.
- `research/` — Upstream Matt Pocock skill for research using primary sources.
- `review-correctness/` — Blind correctness, security, and reliability review.
- `review-design/` — Blind architecture, maintainability, and test-quality review.
- `tdd/` — Red-green-refactor implementation for approved work.
- `change-ai-behavior/` — Grounded AI behavior changes with screening, privacy, tracing, and accounting preserved.
- `evaluate-ai-quality/` — Synthetic quality investigations and controlled prompt/model comparisons using existing evals.
- `diagnose-ai-task/` — Evidence-based diagnosis of queued tasks and interview operations, including delivery and cost uncertainty.
- `add-ai-workflow/` — New queued AI capabilities through Rails, Python, GraphQL, and React with replay-safe lifecycle checks.
- `add-mcp-tool/` — Read-only tools on the `ai-mcp` server, from contract through screening, wiring, tests and docs.
  Also linked from `.claude/skills/` for Claude Code.
- `verify-spoken-interview/` — Routing spoken interview checks across offline harnesses, real QA, and conservative paid diagnostics.
- `to-spec/` — Upstream Matt Pocock skill for turning conversations into specifications.
- `to-tickets/` — Upstream Matt Pocock skill for splitting plans into tickets with dependencies.
- Skill directory names must match their `name` frontmatter.
- Keep secrets in environment variables.
- Do not read, edit, stage, commit, or otherwise touch `KANBAN.md`.
