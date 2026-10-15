# AGENTS.md — docs

## Purpose

Project-level documentation that spans services.

## Contents

- `evals/` — optional timestamped AI quality reports and reporting CLI usage.

- `architecture.md` — services, dependency directions, data flow, queue design, key decisions
- `testing.md` — focused Docker checks, schema generation, offline tests, and paid evals
- `mvp_plan.md` — first milestone scope and build order
- `plans/` — feature plans and implementation tickets; the `orchestrator` skill describes Kanban delivery, approvals, and review.
  `plans/llm_engineering_rules_done.md` lists the LLM-engineering bullets already applied;
  do not implement those again
- Original brainstorm notes live at the repo root: `initial_project_description_and_notes.txt`

## Local Rules

- Record significant decisions in `architecture.md` under "Decisions", with the reasoning.

- `plans/interview_prep.md` — phased interview practice plan and task verification progress.
