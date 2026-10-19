# AGENTS.md — AI task specs

## Purpose and contents

- `enqueue_ai_task_service_spec.rb` — allowance checks and queued task publication.
- `apply_ai_result_service_spec.rb` — domain result application and legacy usage compatibility.
- `record_attempt_usage_spec.rb` — retries, duplicates, late charges, unfinished markers and
  late tailoring reports through result application.
- `concurrent_screening_results_spec.rb` — separate connections exercise late reports
  during draft saving, imports, library clearing and highlight moves without retaining
  conflicting locks; successful checks survive a later outcome/accounting rollback.

## Local rules

Keep real database transactions and stub queue/subscription transports. Verify stored totals
and task outcomes; repeated delivery must not double count. Follow the parent spec rules.
