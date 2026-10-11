# AGENTS.md — services/api/app/graphql/types

## Purpose

GraphQL output/input types, enums, and root operation fields.

## Contents

- `.keep`
- `ai_task_status_enum.rb`
- `ai_task_type.rb`
- `ai_task_type_enum.rb`
- `ai_usage_type.rb`
- `base_argument.rb`
- `base_connection.rb`
- `base_edge.rb`
- `base_enum.rb`
- `base_field.rb`
- `base_input_object.rb`
- `base_interface.rb`
- `base_object.rb`
- `base_scalar.rb`
- `base_union.rb`
- `certification_attributes_input.rb`
- `certification_type.rb`
- `education_attributes_input.rb`
- `education_type.rb`
- `enum_from_values.rb`
- `experience_attributes_input.rb`
- `experience_highlight_type.rb`
- `experience_type.rb`
- `interview_question_set_type.rb`
- `interview_question_type.rb`
- `job_attributes_input.rb`
- `job_gap_response_type.rb`
- `job_stage_enum.rb`
- `job_type.rb`
- `library_fact_attributes_input.rb`
- `library_fact_type.rb`
- `mutation_type.rb`
- `profile_attributes_input.rb`
- `profile_link_attributes_input.rb`
- `profile_link_type.rb`
- `project_attributes_input.rb`
- `project_type.rb`
- `query_type.rb`
- `resume_section_type.rb`
- `resume_section_type_enum.rb`
- `resume_type.rb`
- `skill_attributes_input.rb`
- `skill_type.rb`
- `subscription_type.rb`
- `user_type.rb`

## Local Rules

Root queries must use current_user associations. Interview feedback freshness compares reviewed and current revisions; expose latest tasks for reload restoration. Dump the schema after changes.
