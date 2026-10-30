# AGENTS.md — services/api/app/services/career_library

## Purpose

Keeps the single career library free of duplicates, saves the order of hand-ordered
entries, empties it for a fresh import, and keeps the library's embeddings (for similarity
search by the AI worker) in sync. Used by the resume import (automatic matching), the
`merge*` mutations (the user picks two entries), `clearCareerLibrary`, and `reorderSkills`
(drag-and-drop on the library page).

## Contents

- `find_matching_library_record_service.rb` — returns the existing entry a record duplicates.
  Match keys: experience company + title, project name, education institution + degree (a
  blank degree only matches a blank degree). Text compares case-insensitively with whitespace
  squished. If both records have a start date and they differ, it's not a match (a second
  stint at the same company stays its own role).
- `merge_library_records_service.rb` — merges a source entry into a target of the same model
  and user: fills fields blank on the target, appends highlights the target doesn't have, then
  deletes a saved source. Works with an unsaved source (the import).
- `clear_career_library_service.rb` — deletes the user's roles, projects, education, skills,
  and career context entries, and clears the profile fields an import fills (name, contact, links, summary,
  and generated job-title search suggestions).
  Sign-in email, jobs, and tailored resumes stay. Job answers that pointed at a career context entry stay,
  unlinked. Queues one embedding sync when an entry was removed; a second call changes nothing.
- `reorder_library_entries_service.rb` — saves a new order for a relation of the user's entries
  (used for skills; experiences, projects, and educations are ordered by date instead): the ids
  must be exactly the relation's ids, and each position becomes its index. Repeating the call
  changes nothing.
- `build_embedding_texts_service.rb` — one text per experience, highlight, project, education,
  skill, and career context entry, with context ("Senior Engineer at Acme: Cut deploy time 40%",
  "Languages: Ruby", "Fact: Kubernetes: Used it at Acme for two years"); job-only gap responses
  are not included; queries the tables directly so a sync never sees stale loaded associations
- `sync_library_embeddings_service.rb` — under a per-user advisory lock, embeds entries whose
  SHA-256(model + masked text) digest changed, upserts them into `library_embeddings`, and
  deletes rows whose entry is gone; the API receives placeholders and the stored text stays
  original; returns `{ embedded:, deleted: }`. Idempotent; run by
  `SyncLibraryEmbeddingsJob` and the `career_library:sync_embeddings` backfill

## Local Rules

- Merging never overwrites a value the target already has.
- Exact copied fields/highlights from saved sources keep their existing coverage; unsaved
  imported text remains unchecked. Normal highlight editing keeps coverage only for exact
  unchanged content, even when its rows are recreated.
- An experience's blank `end_date` means "current role", so it is never filled from a merge.
- Add a model's identifying fields to `MATCH_FIELDS` and fillable fields to `FILLABLE_FIELDS`
  together when another entry type becomes mergeable.

- Certifications match normalized name + issuer and compatible issued dates; merges fill optional credential facts. Clear and embedding synchronization include certifications.

## Section review

- `ReviewSnapshot` builds a temporary projection of the requested Summary, Experience, Projects,
  or Career context section. `ReviewCommand` keeps only section, target IDs/context digests and
  per-field fingerprints on review tasks. Python reads the selected owned section directly and
  rejects changed target digests before generation. Only narrative fields become targets.
  The projection helper remains temporarily shared with individual editing pending its migration.
- `StartReviewService` queues or reuses an active `review_library_section` task; `ReviewStateService`
  returns its last completed individual grades and optional enrichment questions with
  current/stale state. Results stay on `AiTask`.
- `AnswerReviewService` resolves an owned current question set and up to three optional indexed
  answers into one proposal. At least one trimmed nonblank answer is required; canonical ordering
  and blank omission deduplicate equivalent batches. Legacy scalar answers remain supported,
  deduplicating exact answers and rejecting unrelated draft conflicts under the owner lock.
  Assessment `review_task_id` names the completed origin, independently of latest task status.
- `ApplyReviewService` validates exact target coverage and ordered sets of up to three distinct nonblank
  questions (at most 500 characters each), normalizing old scalar/questionless results and preserving
  the scalar first question for older clients. `questions_for` is the shared validation/read seam.
  It records screening approvals only
  while the source field matches both the queued field fingerprint and its current value
  under its record lock. Foreign and unselected record receipts cannot earn coverage.

## Individual editing

- `EditSnapshot`, `StartEditService`, and `EditStateService` select one owned field and keep
  resumable editing turns on linked `improve_library_entry` tasks; no separate conversation table.
- `ApplyEditService` validates proposals/questions. `FinishEditService` accepts the exact saved
  proposal once, preserving highlight identity, or discards without changing career facts.
  Accepted and discarded review-answer questions retire from saved review state; failed
  generations retry as linked editing turns with every paired answer intact. Failed batches
  may replay without new feedback; ordinary continuations still need feedback or an explicit skip.
  New continuation turns require the latest edit for that target, so an older failed draft
  cannot displace a newer draft through a stale tab. Exact existing-child retries remain idempotent.
  Summary accepts change only `User.summary`; projects change only `description`; career context entries change
  only `response`. The owned-record allowlist never resolves classes from browser strings.
- Acceptance requires unchanged source/context, queues embeddings, and stores the proposed
  assessment for the new digest. Exact generated text receives reusable field coverage without
  a classifier call; existing manual editors revoke coverage when user text changes.
