# AGENTS.md — background job specs

## Purpose

Non-browser Active Job checks with external providers stubbed.

## Contents

- `career_library/` — existing library sync jobs.
- `interview_prep/` — saved Q&A background generation and provider-failure behavior.

## Local Rules

Follow spec rules. Never call OpenAI; use FakeEmbeddingClient and the test queue adapter.
