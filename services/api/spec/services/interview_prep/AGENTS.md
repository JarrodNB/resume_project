# AGENTS.md — interview prep service specs

## Purpose

Test interview practice service behavior without external AI or queue calls.

## Contents

- `embedding_lifecycle_spec.rb` — save enqueueing, combined/masked text, edit/clear invalidation, invalid-save preservation.
- `embedding_save_spec.rb` — all practice types, unchanged-save eligibility, feedback allowance/publication failures.
- `embedding_sync_spec.rb` — duplicate jobs, ownership, late results, provider failure, and library isolation.
- `embedding_transactions_spec.rb` — actual commits/rollbacks and separate connections prove lock release and duplicate serialization.

- `question_operations_spec.rb` — generation, answers, feedback snapshots, replacement, limits, and deletion.
- Also covers freshness after formatting-only changes and unverified feedback snapshots.

- `apply_questions_spec.rb` — five-slot atomicity, malformed results, ownership/identity, deleted/superseded targets, and usage idempotency.
- `apply_replacement_spec.rb` — revisions, preservation on failure, selected-slot clearing, and current-set distinctness.
- `concurrent_results_spec.rb` — duplicate delivery and competing slot replacements with separate database connections; disables transactional fixtures and deletes only its own user afterward.
- `apply_feedback_spec.rb` — current/delayed coaching, preservation on failure, malformed results, identity/ownership, supersession, deletion, and duplicate usage.

## Local Rules

- Follow parent spec instructions; stub SQS and retain real database persistence.


- `screening_spec.rb` — persisted checks, source ownership/alignment, revision/fingerprint
  staleness, edits/replacements, duplicates, legacy snapshots and metadata serialization.
