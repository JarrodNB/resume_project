# AGENTS.md — services/api/spec/services

## Purpose

Service behavior tests grouped by domain.

## Contents

- `ai_tasks` — subfolder; inherits these rules unless overridden locally.
- `ai_usage` — subfolder; inherits these rules unless overridden locally.
- `career_library` — subfolder; inherits these rules unless overridden locally.
- `certifications` — subfolder; inherits these rules unless overridden locally.
- `experiences` — subfolder; inherits these rules unless overridden locally.
- `embeddings` — embedding API batch usage and partial failure accounting.
- `gap_analysis` — subfolder; inherits these rules unless overridden locally.
- `gap_responses` — subfolder; inherits these rules unless overridden locally.
- `interview_prep` — subfolder; inherits these rules unless overridden locally.
- `jobs` — subfolder; inherits these rules unless overridden locally.
- `resume_imports` — subfolder; inherits these rules unless overridden locally.
- `resume_tailoring` — subfolder; inherits these rules unless overridden locally.

## Local Rules

Follow spec/AGENTS.md. Interview persistence, concurrency, and stale/duplicate result cases live in interview_prep/. Stub external providers and SQS while retaining real database behavior.
