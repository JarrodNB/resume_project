# AGENTS.md — interview practice jobs

## Purpose

Background embedding work for future saved interview answers.

## Contents

- `sync_question_embedding_job.rb` — rechecks configuration and owner, then synchronizes one question; retries temporary provider failures.

## Local Rules

Follow parent job rules. Enqueue after commit; never sweep old answers or perform provider work in saving requests.
