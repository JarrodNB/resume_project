# AGENTS.md — docs

## Purpose

Project-level documentation that spans services.

## Contents

- `evals/` — optional timestamped AI quality reports and reporting CLI usage.

- `conversation_logging.md` — local transcript location, controls, interpretation and cleanup.
- `architecture.md` — service overview, dependency directions, and links to focused guides in `architecture/`
- `architecture/background-jobs.md` — primary-database Solid Queue, transactional enqueue,
  dedicated worker operation and old production queue draining
- `architecture/ai-streaming.md` — optional public output on the shared runner, scoped
  observer capabilities, Redis replay, outage behavior and local latency probes
- `testing.md` — focused Docker checks, schema generation, offline tests, and paid evals
- `interview-real-qa.md` — real spoken browser QA on the retained paid ledger; `interview-recovery.md` keeps offline recovery instructions
- `interview-latency.md` — private stage timing, repeatable offline scheduler measurements, and limits on latency claims
- `interview-transcription.md` — answer input modes, complete-recording fallback, live capture ownership and human device checks
- `mvp_plan.md` — first milestone scope and build order
- `plans/` — feature plans and implementation tickets; the `orchestrator` skill describes Kanban delivery, approvals, and review.
  `plans/llm_engineering_rules_done.md` lists the LLM-engineering bullets already applied;
  do not implement those again
- Original brainstorm notes live at the repo root: `initial_project_description_and_notes.txt`

## Local Rules

- Record significant decisions with their reasoning beside the relevant behavior in `architecture/`; system-wide decisions belong in `architecture.md` under "System decisions".

- `plans/interview_prep.md` — phased interview practice plan and task verification progress.
