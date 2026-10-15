# AGENTS.md — GraphQL subscriptions

## Purpose and contents

- `base_subscription.rb` — shared authenticated user access.
- `ai_task_updated.rb` — owner-authorized task status and initial snapshot.
- `ai_usage_updated.rb` — owner-authorized monthly usage and incomplete accounting snapshot.

## Local rules

Return the current state on subscribe, enforce ownership, and use service-triggered updates.
Usage updates must not change task status. Follow the parent GraphQL instructions.
