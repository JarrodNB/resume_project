# AGENTS.md — interview-prep

## Purpose

Persistent interview preparation sets at `/interview-prep` and `/interview-prep/:id`.

## Contents

- `interviewPrepOperations.ts` — list/detail queries and generation/deletion/answer/feedback/replacement mutations.
- `useInterviewPrep.ts` — data fetching, newest-first sorting, and mutation errors.
- `interviewSetDate.ts` — shared locale-aware creation date formatting.
- `InterviewPrepPage.tsx` — numbered/date list and generation.
- List and detail labels show the persisted general/technical/knowledge type; local General/Technical/Knowledge tabs filter saved sets and choose the generation type, defaulting to general.
- `interviewSetTypeLabel.ts` — shared human-readable persisted scope labels.
- `InterviewSetPage.tsx` — ordered cards, omission warnings, unsaved-answer navigation protection, and generation of a fresh same-type set from failed/idle empty sets.
- `InterviewQuestionCard.tsx` — persistent drafts, save/feedback controls, and confirmed replacement.
- `useInterviewAnswer.ts` — answer/feedback/replacement mutations and retryable errors.
- `InterviewFeedback.tsx` — coaching and examples with explicit highlighted placeholders.
- `InterviewTaskStatus.tsx` — persisted task restoration, visible generation progress, and shared subscription updates.
- `DeleteInterviewSetButton.tsx` — confirmed deletion with retryable error display.
- `InterviewPrepPage.test.tsx`, `InterviewSetPage.test.tsx`, `InterviewAnswers.test.tsx` — page and answer workflow coverage.

## Local rules

- Follow `apps/web/AGENTS.md`; GraphQL fetching stays in hooks.
- Draft and mutation state lives outside collapsed content so collapsing preserves edits and subscriptions.
- Feedback requests save typed answers even when allowance/queueing fails; refresh persisted state without replacing newer drafts.
- Existing feedback is outdated for local unsaved edits as well as persisted revision changes.
- Capitalization and whitespace edits preserve feedback freshness; exact edits still require saving and retain navigation protection.
- Enable feedback only for a nonblank saved answer with no unsaved edits and within the 1,000-character cap.
- Disable feedback after success for the current question/answer revisions; saving a changed answer enables another request. Failed requests remain retryable.
- Show feedback progress beside the answer controls from request submission until the queued task finishes.
- Feedback never fills the answer field; examples remain separate and visibly mark missing facts.
- Allow answer edits during feedback. During replacement, keep editing and conflicting actions locked until the refreshed question revision arrives, including after reload.
- Warn before leaving with unsaved answers; successful confirmed deletion clears that protection.
- Pending sets remain persistent and deletable; subscribe to their tasks, never poll.
- Question cards start collapsed and retain open state using stable set/question ids.
