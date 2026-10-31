# AGENTS.md — services/api/app/services/gap_responses

## Purpose

Saves the user's answers to gap-analysis requirements. An answer always belongs to one job.
Adding it to the career library creates a `CareerContext`; only that context is embedded.

## Contents

- `save_gap_response_service.rb` — upserts a `JobGapResponse` keyed by the requirement text
  (a blank body deletes it). `add_to_library` upserts the user's `CareerContext` for that
  requirement and links it; leaving it off unlinks the context and deletes the context when no
  response still points at it. Queues an embedding sync only when a context is created, its text
  changes, or it is deleted.

- `../screening/record_approvals_service.rb` — accepts final tailoring field fingerprints for answers
  on the owned task subject matching its command job ID and locked current text. Retained
  copied-input tasks also require their original answer membership/value. Successful
  checks survive generation failure; edits clear only changed field approvals atomically.
  CareerContext approvals remain independent.

## Local Rules

- The job is already scoped to the user by the caller.
- A response that stays on the job is never embedded and is not career-library content.

- Acquire the owner lock before answer/context locks for saving or clearing answers, matching
  bulk career-library clearing. Reload existing responses before assigning edits,
  invalidating checks or unlinking career context entries. Final tailoring reports use the same owner-first
  transaction before locking tasks, answers or library records.

- Save/clear operations use savepoints inside the owner transaction so handled rollback
  failures cannot leave partial answer/context changes.
