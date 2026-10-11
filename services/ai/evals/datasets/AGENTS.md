# AGENTS.md — services/ai/evals/datasets

## Purpose

Synthetic YAML cases for the agent evaluation runners in the parent folder.

## Contents

- Existing resume, job posting, gap analysis, tailoring, retrieval, and screening cases.
- `interview_questions_cases.yaml` — full sets, sparse evidence and replacement exclusions.
- `interview_feedback_cases.yaml` — strong, vague, sparse and incomplete answers, plus a career introduction needing reordering.

## Local Rules

- Use synthetic career details only; never include real user data.
- Keep labels and evaluation-only flags out of model prompts.
