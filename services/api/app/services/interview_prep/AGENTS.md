# AGENTS.md — interview prep

## Purpose

User-owned interview practice business logic. Follow parent Rails/service instructions.

## Contents

- `start_question_set_service.rb` — allocates a per-user set number and queues generation after allowance checks.
- `save_answer_service.rb` — explicitly saves or clears bounded answers and advances revisions only when text changes.
- `start_question_task_service.rb` — saves feedback answers, checks replacement confirmation, and queues revision snapshots.
- `delete_question_set_service.rb` — deletes an owned set and its questions while retaining AI usage records.
- `apply_questions_service.rb` — validates generation/replacement drafts and task identity/revisions, then persists atomically inside the owner/task transaction.
- `apply_feedback_service.rb` — validates task ownership/identity and coaching shape; stores reviewed revisions while preserving answers.
- `feedback_outdated_service.rb` — checks revision freshness against completed task snapshots, ignoring capitalization and whitespace edits.

## Local Rules

- Answers are user-written and stay separate from the career library.
- Question IDs are authorized through their owning set.
- Serialize mutations through the owner lock; preserve revisions and task usage records.
- Allow one successful feedback request per question/answer revision pair. Check completed task history under the owner lock; failed requests remain retryable.
- Feedback saves a valid answer before allowance checks; queue or screening failure must preserve it. Saving an empty answer is allowed, but feedback requires nonblank text.
- A successful replacement clears only that question's answer and feedback; failures preserve existing content.

- Result application acquires the owner lock before the task lock, matching enqueue/save/delete. Check replacement distinctness against the current set as well as the old question. Obsolete or invalid completions become failed tasks without modifying domain content; retain billed usage once.

- Delayed feedback after answer edits is outdated; changed questions and superseded tasks are rejected. Feedback never changes the saved answer.
