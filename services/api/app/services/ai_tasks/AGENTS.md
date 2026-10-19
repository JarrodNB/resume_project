# AGENTS.md — services/api/app/services/ai_tasks

## Purpose

Shared AI enqueue, result application, and attempt accounting.

## Contents

- `apply_ai_result_service.rb`
- `enqueue_ai_task_service.rb`
- `record_attempt_usage_service.rb` — resolves unfinished accounting markers and adds each
  execution's known charges once, including retry and late reports.

## Local Rules

Enqueue preparation runs under the owner lock after allowance checks; publish after commit.
Results lock the task; interview results first lock the owner to match interview operations.
Finished tasks keep their
outcome, but new usage attempts are still recorded. Usage-only messages never change task
status or trigger task-state subscriptions.

Optional `screening_successes` reports are applied independently of task outcome and usage,
including retries and late messages. Malformed entries are ignored. The shared
`RecordScreening::ApplySuccessesService` owns allowlisting, ownership and atomic content-version
checks; its state stamps never advance the record's `updated_at`.
The consumer calls result application without an enclosing transaction. Screening stamps
run first as independent atomic updates, releasing each source lock before the next stamp
or the task transaction. They survive a later outcome/accounting failure safely;
redelivery retries the remaining work. Do not move them inside a shared transaction.
