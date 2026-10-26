# AGENTS.md — interview prep

## Purpose

User-owned interview practice business logic. Follow parent Rails/service instructions.

## Contents

- `start_question_set_service.rb` — allocates a per-user set number and queues generation after allowance checks.
- `record_screening_service.rb` — accepts exact owned target/sibling snapshot reports and
  records only current fingerprint/revision matches inside owner-first result application.
- `save_answer_service.rb` — explicitly saves or clears bounded answers and advances revisions only when text changes.
- `start_question_task_service.rb` — saves feedback answers, checks replacement confirmation, and queues revision snapshots.
- `delete_question_set_service.rb` — deletes an owned set and its questions while retaining AI usage records.
- `apply_questions_service.rb` — validates generation/replacement drafts and task identity/revisions, then persists atomically inside the owner/task transaction.
- `apply_feedback_service.rb` — validates task ownership/identity and coaching shape; stores reviewed revisions while preserving answers.
- `feedback_outdated_service.rb` — checks revision freshness against completed task snapshots, ignoring capitalization and whitespace edits.
- `sync_question_embedding_service.rb` — embeds one owned saved Q&A, masks outbound contact, serializes duplicates, and rejects changed/deleted sources after provider work.

## Local Rules

- Answers are user-written and stay separate from the career library.
- Future nonblank saves enqueue question-specific embedding after commit, including unchanged saves and feedback saves. Actual edits and successful replacements delete obsolete vectors transactionally. Never backfill or scan other questions on a save.
- Embedding provider work holds only a question advisory lock, never the owner row lock; snapshots and writes recheck ownership/revisions under the owner lock. Independent embedding costs are outside AI-task accounting.
- General, technical, and knowledge scopes are immutable snapshots; question application checks five type-specific categories, including `concepts`, `mechanisms`, `application`, `reasoning`, and `limitations` for knowledge.
- General outputs use one introduction plus collaboration, problem solving, learning/adaptation and initiative/judgment. Complete legacy general category sets and single legacy replacements remain accepted for in-flight older workers; mixed full sets are rejected. Categories are not stored on question slots.
- Question IDs are authorized through their owning set.
- Serialize mutations through the owner lock; preserve revisions and task usage records.
- Allow one successful feedback request per question/answer revision pair. Check completed task history under the owner lock; failed requests remain retryable.
- Feedback saves a valid answer before allowance checks; queue or screening failure must preserve it. Saving an empty answer is allowed, but feedback requires nonblank text.
- A successful replacement clears only that question's answer and feedback; failures preserve existing content.

- Result application acquires the owner lock before the task lock, matching enqueue/save/delete. Check replacement distinctness against the current set as well as the old question. Obsolete or invalid completions become failed tasks without modifying domain content; retain billed usage once.

- Delayed feedback after answer edits is outdated; changed questions and superseded tasks are rejected. Feedback never changes the saved answer.

- Saved `screened_fields` can contain checks for `question_text`/`answer_text`. The worker
  screens user-written answers and trusts Rails-owned generated question text when reused,
  including during feedback and regeneration. Answer checks depend on both revisions; actual
  answer edits clear them. Successful replacement clears checks for both fields.
- Queue snapshots keep legacy source strings and add primary checks/aligned sibling snapshots.
  These are Rails-owned generated questions; the worker trusts them as generated context even
  when old sibling metadata is absent. Failed final generation still records successful answer
  and library source checks.

- `avoid_question_service.rb` saves the selected question revision as a shared account preference without changing answers. Generation/replacement snapshot all avoided questions under the owner lock; result application rejects exact repeats against that snapshot.
