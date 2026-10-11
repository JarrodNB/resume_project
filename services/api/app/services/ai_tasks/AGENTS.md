# AGENTS.md — services/api/app/services/ai_tasks

## Purpose

Shared AI enqueue, result application, and task republication.

## Contents

- `apply_ai_result_service.rb`
- `enqueue_ai_task_service.rb`
- `republish_ai_task_service.rb`

## Local Rules

Enqueue preparation runs under the owner lock after allowance checks; publish after commit. Interview results acquire the owner lock before the task lock. Ignore finished tasks to avoid duplicate writes and usage.
