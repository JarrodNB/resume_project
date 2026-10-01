# AGENTS.md — services/ai/schemas

## Purpose

Pydantic models for structured LLM outputs (agent `output_type`s). They are also the shape of
the `result` sent to Rails, so changes must be mirrored there.

## Contents

- `parsed_resume.py` — `ParsedResume` and its parts; mirrors the Rails career library and is
  imported by `ResumeImports::ImportParsedResumeService`

## Local Rules

- Give fields `description`s when the model needs guidance; they are sent to the LLM.
- Optional fields default to `None` / empty lists so "not stated" never forces invention.
