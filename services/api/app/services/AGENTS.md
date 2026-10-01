# AGENTS.md — services/api/app/services

## Purpose

All business logic, as service objects grouped by domain folder.

## Contents

- `application_service.rb` — base class: `self.call(...)`, `success(value)`, `failure(errors)`
- `service_result.rb` — immutable result: `success?`, `value`, `errors`
- `records/destroy_record_service.rb` — generic destroy for an already-authorized record
- `jobs/` — `create_job_service.rb`, `update_job_service.rb`, `move_job_to_stage_service.rb`
- `experiences/` — `create_experience_service.rb`, `update_experience_service.rb`

## Local Rules

- Name services `<Verb><Noun>Service` in a domain module: `Jobs::MoveJobToStageService`.
- Subclass `ApplicationService`, take keyword arguments in `initialize`, expose only `call`.
- Always return a `ServiceResult` via `success`/`failure`; never raise for validation errors.
- Services receive records already scoped to the user; they don't do authorization lookups.
- Multi-record changes run in a transaction (see `UpdateExperienceService`).
