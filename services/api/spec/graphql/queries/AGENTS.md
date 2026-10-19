# AGENTS.md — services/api/spec/graphql/queries

## Purpose

Authorized GraphQL query specs.

## Contents

- `interview_prep_spec.rb`
- `scoping_spec.rb`

## Local Rules

Read through current_user. Cover cross-user IDs and interview set ordering, question revisions, latest tasks, and outdated feedback. Keep external calls stubbed.

Job Board search/import intentionally read shared provider catalogue records after HTTP authentication.
All saved Job lookup remains scoped to the current user, including listing/URL matches via
JobBoard::SavedJobLookup. Never expose raw catalogue payloads or provider credentials.
