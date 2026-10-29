# AGENTS.md — interview-prep

## Purpose

Written interview practice (the Practice section's Questions tab): the question bank at
`/practice/questions` and one set worked question by question at `/practice/questions/:id/:questionId?`.

## Contents

- `interviewPrepOperations.ts` — bank, set list/detail queries and generation/deletion/answer/feedback/replacement/avoidance mutations.
- `useInterviewPrep.ts` — data fetching (bank split into active and retired questions), newest-first sets, and mutation errors.
- `questionProgress.ts` — the shared progress steps, labels, and bank filter groups, derived from saved state.
- `QuestionProgressMark.tsx` — the stop/signal mark for a progress step.
- `InterviewPrepPage.tsx` — the bank page: generation, pending sets, bank list, replaced answers, and sets.
- `GenerateQuestionSet.tsx` — type switch, generation, and the empty-library prompt.
- `QuestionBankList.tsx` — progress/type filters, search, and question rows linking into their set.
- `RetiredQuestions.tsx` — read-only answers kept from replaced questions.
- `QuestionSetList.tsx` — pending/failed sets above the bank, finished sets with answered counts and deletion.
- `InterviewSetPage.tsx` — one set: question line, the open card, previous/next, and unsaved-answer navigation protection.
- `QuestionLine.tsx` — the set's questions as linked stops.
- `InterviewQuestionCard.tsx` — persistent drafts, Get feedback/Save, and the actions menu (replace, avoid).
- `useQuestionAvoidance.ts` — revision-bound saved avoidance state and retryable errors without touching drafts.
- `useInterviewAnswer.ts` — answer/feedback/replacement mutations and retryable errors.
- `InterviewFeedback.tsx` — coaching and examples with explicit highlighted placeholders.
- `InterviewTaskStatus.tsx` — persisted task restoration and shared subscription updates.
- `DeleteInterviewSetButton.tsx` — confirmed deletion with retryable error display.
- `interviewSetDate.ts`, `interviewSetTypeLabel.ts` — shared date and type labels.
- `InterviewPrepPage.test.tsx`, `InterviewSetPage.test.tsx`, `InterviewAnswers.test.tsx` — page and answer workflow coverage.

## Local rules

- Follow `apps/web/AGENTS.md`; GraphQL fetching stays in hooks.
- Progress labels and marks come from `questionProgress.ts` so the bank and the question line always agree.
- Signals follow `DESIGN.md`: blue only while feedback is being prepared, red only for out-of-date feedback or failures; other steps use ink stops.
- On the set page every card stays mounted and only the open one is visible, so drafts and subscriptions survive moving between questions. Only leaving the set triggers the unsaved-answer warning.
- Without a question id, pin the default question in the URL once so saving never moves the open question.
- Feedback requests send the typed answer and the server saves it first; queue or allowance failures still refresh the saved answer without replacing newer drafts.
- Existing feedback is outdated for local unsaved edits as well as persisted revision changes.
- Capitalization and whitespace edits keep feedback current: Get feedback stays disabled for them, while Save stays available and navigation protection still applies.
- Disable feedback after success for the current question/answer revisions; a substantive change enables another request. Failed requests remain retryable.
- Feedback never fills the answer field; examples remain separate and visibly mark missing facts.
- Allow answer edits during feedback. During replacement, keep editing and conflicting actions locked until the refreshed question revision arrives, including after reload.
- Replacing an answered question asks first and says the saved answer moves to the replaced-answers section; retired copies are read-only.
- Pending sets remain persistent and deletable; subscribe to their tasks, never poll.
- “Don't show this again” saves a shared preference without skipping or regenerating; restore `avoided` from server state and retain local drafts.
