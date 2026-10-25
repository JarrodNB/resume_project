# AGENTS.md — services/api/app/services/ai_tasks

## Purpose

Shared AI enqueue, result application, and attempt accounting.

## Contents

- `update_task_service.rb` — owner-first task writes and durable outcome insertion; transport runs after all enclosing transactions commit. Callers must acquire the owner before task locks.
- `publish_task_outcome_service.rb` / `describe_task_outcome_service.rb` — owner-scoped notice delivery and safe labels/destinations, with no raw generated content or errors.
- `apply_ai_result_service.rb`
- `enqueue_ai_task_service.rb`
- `record_attempt_usage_service.rb` — resolves unfinished accounting markers and adds each
  execution's known charges once, including retry and late reports.

## Local Rules

Enqueue preparation runs under the owner lock after allowance checks; publish after commit.
Interview, gap-analysis and tailoring results acquire the owner lock before the task lock.
Gap-analysis/tailoring then lock job, answer and library rows as needed, sharing owner-first
ordering with saved-answer writes and bulk library clearing. Finished tasks keep their
outcome, but new usage attempts are still recorded. Usage-only messages never change task
status or trigger task-state subscriptions.
