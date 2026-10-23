# AGENTS.md — Codex Skills

## Purpose

Reusable, repository-scoped workflows for Codex.

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
- `orchestrator/` — Local Kanban delivery, approvals, delegation, and handoff.
- `research/` — Upstream Matt Pocock skill for research using primary sources.
- `review-correctness/` — Blind correctness, security, and reliability review.
- `review-design/` — Blind architecture, maintainability, and test-quality review.
- `tdd/` — Red-green-refactor implementation for approved work.
- `to-spec/` — Upstream Matt Pocock skill for turning conversations into specifications.
- `to-tickets/` — Upstream Matt Pocock skill for splitting plans into tickets with dependencies.
- Skill directory names must match their `name` frontmatter.
- Keep secrets in environment variables.
