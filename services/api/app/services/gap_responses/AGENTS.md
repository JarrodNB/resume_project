# AGENTS.md — services/api/app/services/gap_responses

## Purpose

Saves the user's answers to gap-analysis requirements. An answer always belongs to one job.
Adding it to the career library creates a `LibraryFact`; only that fact is embedded.

## Contents

- `save_gap_response_service.rb` — upserts a `JobGapResponse` keyed by the requirement text
  (a blank body deletes it). `add_to_library` upserts the user's `LibraryFact` for that
  requirement and links it; leaving it off unlinks the fact and deletes the fact when no
  response still points at it. Queues an embedding sync only when a fact is created, its text
  changes, or it is deleted.

- `record_screening_service.rb` — accepts final tailoring field fingerprints for owned
  task-snapshot answer IDs, matching both snapshot and locked current text. Successful
  checks survive generation failure; edits clear only changed field approvals atomically.
  LibraryFact approvals remain independent.

## Local Rules

- The job is already scoped to the user by the caller.
- A response that stays on the job is never embedded and is not career-library content.

- Acquire the owner lock before answer/fact locks for saving or clearing answers, matching
  bulk career-library clearing. Reload existing responses before assigning edits,
  invalidating checks or unlinking facts. Final tailoring reports use the same owner-first
  transaction before locking tasks, answers or library records.

- Save/clear operations use savepoints inside the owner transaction so handled rollback
  failures cannot leave partial answer/fact changes.
