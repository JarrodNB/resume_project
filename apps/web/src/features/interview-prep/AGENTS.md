# AGENTS.md — interview-prep

## Purpose

Written interview practice (the Practice section's Questions tab): the question bank at
`/practice/questions`, with answer editors inline in the bank. Old detail URLs redirect to the bank.

## Contents

- `interviewPrepOperations.ts` — bank, set list/detail queries and generation/deletion/answer/feedback/replacement/avoidance mutations.
- `useInterviewPrep.ts` — data fetching (bank split into active and retired questions), newest-first sets, and mutation errors.
- `questionProgress.ts` — the shared progress labels and `hasFeedback`; the step itself comes from the server's `progress`.
- `QuestionProgressMark.tsx` — the stop/signal mark for a progress step.
- `InterviewPrepPage.tsx` — the bank page: generation, pending requests, bank list, and replaced answers.
- `AddCustomQuestion.tsx` — typed candidate question creation with an optional answer and no library prerequisite.
- `GenerateQuestionSet.tsx` — type switch, generation, and the empty-library prompt.
- `QuestionBankList.tsx` — type tabs, cue-aware search, question rows, inline answer editing, confirmed deletion, and the shared selection for rehearsal.
- `QuestionRehearsal.tsx` — local recall of filtered saved answers, optional cues, reveal/hide, navigation, shuffle passes, and editor links.
- `RetiredQuestions.tsx` — read-only answers kept from replaced questions.
- `PendingQuestionGeneration.tsx` — pending/failed generation requests above the bank with live status and dismissal.
- `InlineQuestionEditor.tsx` — loads the existing answer card in the bank and refreshes saved bank state.
- `InterviewQuestionCard.tsx` — persistent drafts, Get feedback/Save, and the actions menu (replace, avoid, confirmed single-question deletion).
- `DeleteQuestionDialog.tsx`, `DeleteQuestionButton.tsx`, `useDeleteQuestion.ts` — shared confirmed deletion, list action, and mutation/cache cleanup.
- `useQuestionAvoidance.ts` — revision-bound saved avoidance state and retryable errors without touching drafts.
- `answerFormats.ts` — format descriptions, independent draft normalization, and active-answer projection.
- `useInterviewAnswer.ts` — answer/feedback/replacement mutations and retryable errors.
- `InterviewFeedback.tsx` — coaching and examples with explicit highlighted placeholders.
- `InterviewTaskStatus.tsx` — persisted task restoration and shared subscription updates.
- `DismissQuestionGenerationButton.tsx` — confirmed dismissal of empty generation requests with retryable errors.
- `interviewSetDate.ts`, `interviewSetTypeLabel.ts` — shared date and type labels.
- `InterviewPrepPage.test.tsx`, `InterviewAnswers.test.tsx` — page and answer workflow coverage.

## Local rules

- Follow `apps/web/AGENTS.md`; GraphQL fetching stays in hooks.
- Progress labels and marks come from `questionProgress.ts` so progress stays consistent.
- Signals follow `DESIGN.md`: blue while feedback is being prepared; optional outdated feedback uses the normal answered ink stop, with no warning color. Failures retain error alerts.
- Practice opens one question at a time inside its type tab; old detail URLs redirect to the bank. Leaving an unsaved answer or memory anchor requires confirmation, including navigation to another question.
- Rehearsal uses active questions with nonblank saved answers from the bank search, starting with its current type tab and allowing type changes during practice; it makes no API requests or durable progress changes. Hidden answers must be absent from the DOM. Arrow navigation stays inside rehearsal and ignores editable fields and modified shortcuts; return restores the type tab, search, and focus. Shuffle starts another pass only at the end of a shuffled pass.
- Sets remain a backend storage detail: do not show batch numbers, batch management, or navigation limited to a generation batch.
- Each question keeps separate Plain text, CAR, CARL, and STAR drafts. Switching formats never converts text. Save, feedback, and anchor requests persist all drafts and the selected format together; only the active format changes feedback currentness.
- Feedback requests send the typed answer and memory anchor and the server saves both first; queue or allowance failures still refresh the saved answer without replacing newer drafts.
- Existing feedback is outdated for local unsaved edits as well as persisted revision changes.
- Capitalization and whitespace edits keep feedback current: Get feedback stays disabled for them, while Save stays available and navigation protection still applies.
- Disable feedback after success for the current question/answer revisions; a substantive change enables another request. Failed requests remain retryable.
- Feedback never fills the answer field; examples remain separate and visibly mark missing facts.
- Allow answer edits during feedback. During replacement, keep editing and conflicting actions locked until the refreshed question revision arrives, including after reload.
- Replace asks first when the saved question is answered (the dialog says the answer moves to the replaced-answers section), or when unsaved edits would be lost (the dialog then says nothing is kept). A question whose only text is in an inactive format draft replaces at once, like the server: only the active answer counts. Retired copies are read-only.
- Pending generation remains persistent and dismissible while it has no questions; subscribe to tasks, never poll.
- Generation stays on the question bank page: refresh pending requests after enqueueing and show all new questions there on completion.
- “Don't show this again” saves a shared preference without skipping or regenerating; restore `avoided` from server state and retain local drafts.

- Memory anchors remain optional and editable (600 characters). Generate/Regenerate anchor saves both drafts before queueing, restores pending tasks on reload, disables conflicting AI actions, and preserves edits made during generation. Generated cues mirror each answer sentence in order; behavioral C:/A★:/R★:/L: labels apply only where supported.
