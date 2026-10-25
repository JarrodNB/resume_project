# AGENTS.md — features/ai-tasks

## Purpose

Following an AI task live, shared by every feature that starts one (resume import, job
scraping, gap analysis, resume tailoring, interview prep).

## Contents

- `aiTaskOperations.ts` — `AI_TASK_UPDATED_SUBSCRIPTION` (includes `job { id }` for scrape_job,
  and `input` / `pendingQuestions` so tailoring can reload)
- `TaskNotifications.tsx` / `useTaskNotifications.ts` — signed-in layout notices for every terminal task outcome, including the current page; key the host by account ID.
- `followTaskOutcomes.ts` — ordered catch-up after subscription registration, owner-scoped browser checkpoint and Web Lock delivery across tabs; hidden outcomes remain unacknowledged. Storage/lock restrictions degrade recovery/cross-tab guarantees without breaking live delivery.
- `taskNotificationOperations.ts` — owner-scoped outcome feed and bounded catch-up query, with an initial cursor-only registration message.
- `useAiTaskUpdates.ts` — `useAiTaskUpdates(aiTaskId)`: latest task state + subscription error

## Local Rules

- Pages built on this must work on reload: the subscription sends the task's current state first.
