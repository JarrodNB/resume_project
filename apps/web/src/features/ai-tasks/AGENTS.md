# AGENTS.md — features/ai-tasks

## Purpose

Following an AI task live, shared by every feature that starts one (resume import, job
scraping).

## Contents

- `aiTaskOperations.ts` — `AI_TASK_UPDATED_SUBSCRIPTION` (includes `job { id }` for scrape_job)
- `useAiTaskUpdates.ts` — `useAiTaskUpdates(aiTaskId)`: latest task state + subscription error

## Local Rules

- Pages built on this must work on reload: the subscription sends the task's current state first.
