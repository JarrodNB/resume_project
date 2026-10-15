# AGENTS.md — features/ai-tasks

## Purpose

Following an AI task live, shared by every feature that starts one (resume import, job
scraping, gap analysis, resume tailoring, interview prep).

## Contents

- `aiUsageOperations.ts`, `useAiUsage.ts` — owner-authorized monthly usage stream with its
  current snapshot; never polls.
- `AiUsageSummary.tsx`, `AiUsageSummary.test.tsx` — known spend and budget in the signed-in
  layout, with an explicit notice when request costs are unknown.

- `aiTaskOperations.ts` — `AI_TASK_UPDATED_SUBSCRIPTION` (includes `job { id }` for scrape_job,
  and `input` / `pendingQuestions` so tailoring can reload)
- `useAiTaskUpdates.ts` — `useAiTaskUpdates(aiTaskId)`: latest task state + subscription error

## Local Rules

- Pages built on this must work on reload: the subscription sends the task's current state first.
