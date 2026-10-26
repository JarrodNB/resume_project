# AGENTS.md — AI task specs

## Purpose and contents

- `update_task_service_spec.rb` — atomic outcomes, rollback, post-commit delivery, duplicate writes and explicit retry occurrences.
- `describe_task_outcome_service_spec.rb` — all-task labels and safe owned destinations.
- `enqueue_ai_task_service_spec.rb` — allowance checks and queued task publication.
- `apply_ai_result_service_spec.rb` — domain result application and legacy usage compatibility.
- `record_attempt_usage_spec.rb` — retries, duplicates, late charges, unfinished markers and
  late tailoring reports through result application.

## Local rules

Keep real database transactions and stub queue/subscription transports. Verify stored totals
and task outcomes; repeated delivery must not double count. Follow the parent spec rules.
