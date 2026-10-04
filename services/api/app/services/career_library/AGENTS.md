# AGENTS.md — services/api/app/services/career_library

## Purpose

Keeps the single career library free of duplicates, and saves the order of hand-ordered
entries. Used by the resume import (automatic matching), the `merge*` mutations (the user
picks two entries), and `reorderSkills` (drag-and-drop on the library page).

## Contents

- `find_matching_library_record_service.rb` — returns the existing entry a record duplicates.
  Match keys: experience company + title, project name, education institution + degree (a
  blank degree only matches a blank degree). Text compares case-insensitively with whitespace
  squished. If both records have a start date and they differ, it's not a match (a second
  stint at the same company stays its own role).
- `merge_library_records_service.rb` — merges a source entry into a target of the same model
  and user: fills fields blank on the target, appends highlights the target doesn't have, then
  deletes a saved source. Works with an unsaved source (the import).
- `reorder_library_entries_service.rb` — saves a new order for a relation of the user's entries
  (used for skills; experiences, projects, and educations are ordered by date instead): the ids
  must be exactly the relation's ids, and each position becomes its index. Repeating the call
  changes nothing.

## Local Rules

- Merging never overwrites a value the target already has.
- An experience's blank `end_date` means "current role", so it is never filled from a merge.
- Add a model's identifying fields to `MATCH_FIELDS` and fillable fields to `FILLABLE_FIELDS`
  together when another entry type becomes mergeable.
