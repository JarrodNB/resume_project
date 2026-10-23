# AGENTS.md — services/api/app/services/career_library

## Purpose

Keeps the single career library free of duplicates, saves the order of hand-ordered
entries, empties it for a fresh import, and keeps the library's embeddings (for similarity
search by the AI worker) in sync. Used by the resume import (automatic matching), the
`merge*` mutations (the user picks two entries), `clearCareerLibrary`, and `reorderSkills`
(drag-and-drop on the library page).

## Contents

- `find_matching_library_record_service.rb` — returns the existing entry a record duplicates.
  Match keys: full ordered experience role/date/scope structure plus company, project name, education institution + degree (a
  blank degree only matches a blank degree). Text compares case-insensitively with whitespace
  squished. If both records have a start date and they differ, it's not a match (a second
  stint at the same company stays its own role).
- `merge_library_records_service.rb` — merges a source entry into a target of the same model
  and user: fills fields blank on the target, appends highlights the target doesn't have, then
  deletes a saved source. Works with an unsaved source (the import).
- `clear_career_library_service.rb` — deletes the user's roles, projects, education, skills,
  and facts, and clears the profile fields an import fills (name, contact, links, summary).
  Sign-in email, jobs, and tailored resumes stay. Job answers that pointed at a fact stay,
  unlinked. Queues one embedding sync when an entry was removed; a second call changes nothing.
- `reorder_library_entries_service.rb` — saves a new order for a relation of the user's entries
  (used for skills; experiences, projects, and educations are ordered by date instead): the ids
  must be exactly the relation's ids, and each position becomes its index. Repeating the call
  changes nothing.
- `build_embedding_texts_service.rb` — one text per experience, highlight, project, education,
  skill, and library fact, with context ("Senior Engineer at Acme: Cut deploy time 40%",
  "Languages: Ruby", "Fact: Kubernetes: Used it at Acme for two years"); job-only gap responses
  are not included; queries the tables directly so a sync never sees stale loaded associations
- `sync_library_embeddings_service.rb` — under a per-user advisory lock, embeds entries whose
  SHA-256(model + masked text) digest changed, upserts them into `library_embeddings`, and
  deletes rows whose entry is gone; the API receives placeholders and the stored text stays
  original; returns `{ embedded:, deleted: }`. Idempotent; run by
  `SyncLibraryEmbeddingsJob` and the `career_library:sync_embeddings` backfill

## Local Rules

- Merging preserves nonblank values. Experience merges delegate to `Experiences::MergeExperiencesService`: retain distinct roles/scopes and combine differing descriptions; other entry types fill blanks.
- An experience's blank `end_date` means "current role", so it is never filled from a merge.
- Add a model's identifying fields to `MATCH_FIELDS` and fillable fields to `FILLABLE_FIELDS`
  together when another entry type becomes mergeable.

- Certifications match normalized name + issuer and compatible issued dates; merges fill optional credential facts. Clear and embedding synchronization include certifications.
