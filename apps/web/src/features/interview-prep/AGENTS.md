# AGENTS.md — interview-prep

## Purpose

Written interview practice (the Practice section's Questions tab): the question bank at
`/practice/questions` and individual question practice at `/practice/questions/:id/:questionId?`.

## Contents

- `interviewPrepOperations.ts` — bank, set list/detail queries and generation/deletion/answer/feedback/replacement/avoidance mutations.
- `useInterviewPrep.ts` — data fetching (bank split into active and retired questions), newest-first sets, and mutation errors.
- `questionProgress.ts` — the shared progress steps, labels, and bank filter groups, derived from saved state.
- `QuestionProgressMark.tsx` — the stop/signal mark for a progress step.
- `InterviewPrepPage.tsx` — the bank page: generation, pending requests, bank list, and replaced answers.
- `GenerateQuestionSet.tsx` — type switch, generation, and the empty-library prompt.
- `QuestionBankList.tsx` — progress/type filters, search, and question rows linking to individual practice, with confirmed deletion from each row.
- `RetiredQuestions.tsx` — read-only answers kept from replaced questions.
- `PendingQuestionGeneration.tsx` — pending/failed generation requests above the bank with live status and dismissal.
- `InterviewSetPage.tsx` — one question, generation restoration, and unsaved-answer navigation protection.
- `InterviewQuestionCard.tsx` — persistent drafts, Get feedback/Save, and the actions menu (replace, avoid, confirmed single-question deletion).
- `DeleteQuestionDialog.tsx`, `DeleteQuestionButton.tsx`, `useDeleteQuestion.ts` — shared confirmed deletion, list action, and mutation/cache cleanup.
- `useQuestionAvoidance.ts` — revision-bound saved avoidance state and retryable errors without touching drafts.
- `useInterviewAnswer.ts` — answer/feedback/replacement mutations and retryable errors.
- `InterviewFeedback.tsx` — coaching and examples with explicit highlighted placeholders.
- `InterviewTaskStatus.tsx` — persisted task restoration and shared subscription updates.
- `DismissQuestionGenerationButton.tsx` — confirmed dismissal of empty generation requests with retryable errors.
- `interviewSetDate.ts`, `interviewSetTypeLabel.ts` — shared date and type labels.
- `InterviewPrepPage.test.tsx`, `InterviewSetPage.test.tsx`, `InterviewAnswers.test.tsx` — page and answer workflow coverage.

## Local rules

- Follow `apps/web/AGENTS.md`; GraphQL fetching stays in hooks.
- Progress labels and marks come from `questionProgress.ts` so progress stays consistent.
- Signals follow `DESIGN.md`: blue only while feedback is being prepared, red only for out-of-date feedback or failures; other steps use ink stops.
- Practice opens one question at a time. Leaving an unsaved answer requires confirmation, including navigation to another question.
- Sets remain a backend storage detail: do not show batch numbers, batch management, or navigation limited to a generation batch.
- Without a question id, pin the default question in the URL once so saving never moves the open question.
- Feedback requests send the typed answer and the server saves it first; queue or allowance failures still refresh the saved answer without replacing newer drafts.
- Existing feedback is outdated for local unsaved edits as well as persisted revision changes.
- Capitalization and whitespace edits keep feedback current: Get feedback stays disabled for them, while Save stays available and navigation protection still applies.
- Disable feedback after success for the current question/answer revisions; a substantive change enables another request. Failed requests remain retryable.
- Feedback never fills the answer field; examples remain separate and visibly mark missing facts.
- Allow answer edits during feedback. During replacement, keep editing and conflicting actions locked until the refreshed question revision arrives, including after reload.
- Replacing an answered question asks first and says the saved answer moves to the replaced-answers section; retired copies are read-only.
- Pending generation remains persistent and dismissible while it has no questions; subscribe to tasks, never poll.
- “Don't show this again” saves a shared preference without skipping or regenerating; restore `avoided` from server state and retain local drafts.
