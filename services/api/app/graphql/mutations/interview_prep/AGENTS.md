# AGENTS.md — interview prep

## Purpose

User-owned interview practice operations. Follow parent service/GraphQL instructions.

## Contents

- `generate_interview_question_set.rb` — queues a new owned question set.
- `save_interview_answer.rb` — saves or clears an answer through an owned set.
- `regenerate_interview_question.rb` — queues replacement, requiring confirmation for an answered question.
- `request_interview_answer_feedback.rb` — saves the submitted answer and queues coaching.
- `delete_interview_question_set.rb` — deletes an owned set and its questions.

## Local Rules

- Answers are user-written and stay separate from the career library.
- Question IDs are authorized through their owning set.
- Serialize mutations through the owner lock; preserve revisions and task usage records.
- Keep mutations thin: resolve ownership, delegate to `InterviewPrep` services, and return task/validation results.
