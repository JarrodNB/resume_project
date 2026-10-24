# AGENTS.md — services/ai/tailoring

## Purpose

Generate one constrained Markdown resume from the complete screened owned library and job.
Rails owns saved documents; this module returns queued task results without domain writes.

## Contents

- `tailor_resume_input.py` — immutable job/contact/gap/target request snapshots.
- `library_narrative.py` — substantive narrative counting for the two-page start recheck.
- `generate_resume_draft.py` — source screening, whole-document writer, render/measurement,
  and separate editorial review with at most three drafts.

## Local Rules

- Preserve screening, privacy, task-wide deadline, usage accounting and cancellation.
- Completed results must be measured and independently reviewed. Failures cannot publish
  partial drafts. Explain a shorter fallback when relevant evidence cannot support two pages.
- Library data stays structured; saved resumes are Markdown. No section writers, retrieval
  truncation, evidence-label validators or copied section materialization belong here.
- Retrieval benchmark query/cutoff helpers live in `evals/`, separate from resume generation.
