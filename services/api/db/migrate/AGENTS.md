# AGENTS.md — services/api/db/migrate

## Purpose

Ordered Rails migrations for domain persistence.

## Contents

- `20261015010000_create_ai_usage_attempts.rb` — execution-level usage identity and uncertainty.
- `20261015010100_add_finalized_to_ai_usage_attempts.rb` — unfinished/final report ordering.

- `20261001072829_devise_create_users.rb`
- `20261001072901_create_jwt_denylists.rb`
- `20261001072932_create_experiences.rb`
- `20261001073003_create_experience_highlights.rb`
- `20261001073035_create_projects.rb`
- `20261001073105_create_educations.rb`
- `20261001073136_create_skills.rb`
- `20261001073205_create_jobs.rb`
- `20261001073221_create_resumes.rb`
- `20261001073237_create_resume_sections.rb`
- `20261001073254_create_ai_tasks.rb`
- `20261001093946_create_active_storage_tables.active_storage.rb`
- `20261001094026_add_accepted_at_to_ai_tasks.rb`
- `20261002103000_add_usage_to_ai_tasks.rb`
- `20261002103100_add_ai_usage_limit_overrides_to_users.rb`
- `20261002140000_add_profile_fields_to_users.rb`
- `20261002140100_remove_kind_from_resumes.rb`
- `20261005040000_enable_pgvector.rb`
- `20261005040100_create_library_embeddings.rb`
- `20261005120000_create_gap_responses.rb`
- `20261005140000_add_generation_to_ai_tasks.rb`
- `20261008054100_add_responsibilities_to_jobs.rb`
- `20261010010000_create_certifications.rb`
- `20261010020000_add_certification_date_precision.rb`
- `20261010030000_create_interview_question_sets.rb`
- `20261012010000_add_set_type_to_interview_question_sets.rb` — required general/technical type with legacy default and database constraint.
- `20261012020000_allow_knowledge_interview_question_sets.rb` — expands the constraint to knowledge without rewriting existing scopes.

## Local Rules

Use UUID keys and database constraints for required/unique fields. Interview slots have unique positions per set and revision constraints. Run migrations in Docker; never edit schema.rb manually.
