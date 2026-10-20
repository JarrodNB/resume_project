# AGENTS.md — services/api/app/graphql/mutations

## Purpose

GraphQL mutations grouped by domain, including interview_prep/.

## Contents

- `.keep`
- `base_mutation.rb`
- `career_library` — subfolder; inherits these rules unless overridden locally.
- `certifications` — subfolder; inherits these rules unless overridden locally.
- `educations` — subfolder; inherits these rules unless overridden locally.
- `experiences` — subfolder; inherits these rules unless overridden locally.
- `gap_analysis` — subfolder; inherits these rules unless overridden locally.
- `gap_responses` — subfolder; inherits these rules unless overridden locally.
- `interview_prep` — subfolder; inherits these rules unless overridden locally.
- `jobs` — subfolder; inherits these rules unless overridden locally.
- `library_facts` — subfolder; inherits these rules unless overridden locally.
- `projects` — subfolder; inherits these rules unless overridden locally.
- `resume_imports` — subfolder; inherits these rules unless overridden locally.
- `resume_tailoring` — subfolder; inherits these rules unless overridden locally.
- `skills` — subfolder; inherits these rules unless overridden locally.
- `users` — subfolder; inherits these rules unless overridden locally.

## Local Rules

Resolve records through current_user, then delegate to services. Question operations scope questionId through an owned questionSetId. Preserve errors in mutation payloads.

Job Board search/import intentionally read shared provider catalogue records after HTTP authentication.
All saved Job lookup remains scoped to the current user, including listing/URL matches via
JobBoard::SavedJobLookup. Never expose raw catalogue payloads or provider credentials.
