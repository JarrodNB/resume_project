# AGENTS.md — apps/web

## Purpose

The main user-facing app: resume builder, job board, gap analysis chat, application tracking.

## Stack

Vite, React, TypeScript, Apollo Client (GraphQL against `services/api`).

## Local Rules

- Components are small and single-purpose; split when a component handles more than one concern.
- Data fetching lives in hooks (`useTailoredResume`), not inline in components.
- GraphQL operations live next to the feature that uses them.
- Live updates (AI task progress, questions from the AI) come from GraphQL subscriptions over
  an ActionCable link in Apollo. Don't poll.
- Organize by feature (`src/features/resumes/`, `src/features/jobs/`), with shared UI in `src/components/`.
- File header format: see `apps/AGENTS.md`.

## Contents

Generated with `create-vite` (React + TypeScript template, Vite 8, oxlint).

- `src/` — still the Vite starter; replaced when the web app step begins
- `vite.config.ts` — dev server on `0.0.0.0:5173` with polling (needed for Docker on Windows)
- `Dockerfile.dev` — local dev image; `node_modules` lives in a container volume
- Add a package: `docker compose run --rm web npm install <package>`, then rebuild

Not added yet: Apollo Client, routing, feature folders.
