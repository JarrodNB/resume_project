# AGENTS.md — services/ai/evals/datasets

## Purpose

Synthetic YAML cases for the agent evaluation runners in the parent folder.

## Contents

- `prompt_guardrail_cases.yaml` — benign and malicious assembled library/job context;
  parsing cases with `expects_input_block` are included by the guardrail runner.
- Existing resume, job posting, gap analysis, tailoring, retrieval, and screening cases.
- `interview_questions_cases.yaml` — general/technical/knowledge full sets, sparse evidence and replacement exclusions, including nontechnology subjects.
- `interview_feedback_cases.yaml` — personal-answer coaching plus knowledge misconceptions and omissions needing corrected subject examples without invented experience.
  Both written interview datasets support saved career context responses with separately interpreted requirement context.

## Local Rules

- Use synthetic career details only; never include real user data.
- Keep labels and evaluation-only flags out of model prompts.
