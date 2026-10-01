# AGENTS.md — services/api/app/models

## Purpose

Domain models. Associations, validations, enums, and tiny predicates only; no business logic.

## Contents

- `user.rb` — account (Devise + JWT); owns everything below
- `jwt_denylist.rb` — revoked tokens (sign-out)
- Career library (source of truth for the user's facts):
  - `experience.rb` + `experience_highlight.rb` (ordered bullet points)
  - `project.rb`, `education.rb`, `skill.rb`
- `job.rb` — job profile + application stage
- `resume.rb` + `resume_section.rb` — resume documents; section `content` is a JSON snapshot,
  so editing a resume never changes the career library (content shapes in `resume_section.rb`)
- `ai_task.rb` — one unit of AI work over SQS; `finished?` drives duplicate-result handling;
  `source_file` (Active Storage) is the upload a task reads; `accepted?` once its result has
  been imported

## Local Rules

- String enums: define a frozen `CONSTANT` list and use `enum :field, CONSTANT.index_with(&:itself), validate: true`.
  GraphQL enums are generated from these constants, so add values in one place.
- Ordered children use a `position` column and an ordered `has_many` scope.
