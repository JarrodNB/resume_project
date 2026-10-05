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

## Local Rules

- The job is already scoped to the user by the caller.
- A response that stays on the job is never embedded and is not career-library content.
