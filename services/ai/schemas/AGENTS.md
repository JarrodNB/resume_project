# AGENTS.md — services/ai/schemas

## Purpose

Pydantic models for structured LLM outputs (agent `output_type`s). They are also the shape of
the `result` sent to Rails, so changes must be mirrored there.

## Contents

- `parsed_resume.py` — `ParsedResume` and its parts; mirrors the Rails career library and is
  imported by `ResumeImports::ImportParsedResumeService`
- `scraped_job_posting.py` — `ScrapedJobPosting`, the `scrape_job` result
  (`result["scraped_job"]`); Rails turns it into a Job in
  `Jobs::CreateJobFromScrapedPostingService`
- `sorted_requirement_bullets.py` — `SortedRequirementBullets`, the job requirements sorting
  agent's output (1-based bullet numbers)

## Local Rules

- Give fields `description`s when the model needs guidance; they are sent to the LLM.
- Optional fields default to `None` / empty lists so "not stated" never forces invention.
