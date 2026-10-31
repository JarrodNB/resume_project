# AGENTS.md — interview prep

## Purpose

User-owned interview practice business logic. Follow parent Rails/service instructions.

## Contents

- `start_question_set_service.rb` — allocates a per-user set number and queues generation after allowance checks, using only set identity/type/number. Python reads up to 20 recent same-type generated questions as soft variety guidance.
- `record_screening_service.rb` — delegates exact owned target/sibling receipt reports and
  records only current fingerprint/revision matches inside owner-first result application.
- `save_answer_service.rb` — explicitly saves or clears bounded answers and advances revisions only when text changes.
- `start_question_task_service.rb` — saves feedback answers, checks replacement confirmation, and queues replacement/feedback identity/revision commands.
- `delete_question_set_service.rb` — deletes an owned set and its questions while retaining AI usage records.
- `apply_questions_service.rb` — validates generation/replacement drafts and task identity/revisions, then persists atomically inside the owner/task transaction, retiring an answered copy on replacement.
- `apply_feedback_service.rb` — validates task ownership/identity and coaching shape; stores reviewed revisions while preserving answers.
- `feedback_outdated_service.rb` — checks revisions and normalized answer digests against completed feedback, ignoring capitalization and whitespace edits.
- `sync_question_embedding_service.rb` — embeds one owned saved Q&A, masks outbound contact, serializes duplicates, and rejects changed/deleted sources after provider work.

## Local Rules

- Answers are user-written and stay separate from the career library.
- Future nonblank saves enqueue question-specific embedding after commit, including unchanged saves and feedback saves. Actual edits delete obsolete vectors transactionally; successful replacements move an answered slot's vector to its retired copy. Never backfill or scan other questions on a save.
- Embedding provider work holds only a question advisory lock, never the owner row lock; snapshots and writes recheck ownership/revisions under the owner lock. Each batch retains an independent durable receipt included in per-user general/combined spend.
- General, technical, and knowledge scopes are immutable snapshots; question application checks five type-specific categories, including `concepts`, `mechanisms`, `application`, `reasoning`, and `limitations` for knowledge.
- General outputs use one introduction plus collaboration, problem solving, learning/adaptation and initiative/judgment. Complete legacy general category sets and single legacy replacements remain accepted for in-flight older workers; mixed full sets are rejected. Categories are not stored on question slots.
- Question IDs are authorized through their owning set.
- Serialize mutations through the owner lock; preserve revisions and task usage records.
- Allow one successful feedback request per question/answer revision pair. Check completed task history under the owner lock; failed requests remain retryable.
- Feedback saves a valid answer before allowance checks; queue or screening failure must preserve it. Saving an empty answer is allowed, but feedback requires nonblank text.
- A successful replacement first keeps a nonblank answer as a retired copy (same revisions, feedback, approvals, and moved vector), then clears only that slot's answer and feedback; failures preserve existing content.
- Retired copies have `retired_at` and no position. `InterviewQuestionSet#questions` is active-only, so every slot rule and mutation ignores them; never make them editable through the slot mutations.

- Result application acquires the owner lock before the task lock, matching enqueue/save/delete. Check replacement distinctness against the current set as well as the old question. Obsolete or invalid completions become failed tasks without modifying domain content; retain billed usage once.

- Delayed feedback after answer edits is outdated; changed questions and superseded tasks are rejected. Feedback never changes the saved answer.

- Saved `screened_fields` can contain checks for `question_text`/`answer_text`. The worker
  screens user-written answers and trusts Rails-owned generated question text when reused,
  including during feedback and regeneration. Answer checks depend on both revisions; actual
  answer edits clear them. Successful replacement clears checks for both fields.
- Generation/replacement/feedback commands carry only IDs, type/number, target/peer revisions
  and (for feedback) a normalized answer digest.
  Python reads saved generated sources and preferences directly. Retained replacement
  copies validate current sources but never become model input. The shared recorder accepts
  receipts only for selected owned IDs with current fingerprints/revisions; answers are
  never approved by replacement tasks. Feedback reads the owned saved answer and current
  approvals at its commanded revisions; later edits keep coaching attributed to the old
  revisions without changing the saved answer.

- `avoid_question_service.rb` saves the selected question revision as a shared account preference without changing answers. Python reads all owned avoided questions; result application rejects exact repeats against current preferences.
