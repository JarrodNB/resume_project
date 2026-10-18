# LLM as a judge — tickets

Breakdown approved by the user on 2026-10-18. Tickets are implemented only after
integration and verification.

## 01 — Deliver one judge attempt per interview case

**What to build:** Replace per-rubric judge calls in both interview suites with one
structured evaluation containing all applicable scores and reasons. Configure its
model independently, defaulting to `openai:gpt-6.1-sol`, and preserve native reports,
Logfire scores, usage capture, and failure behavior.

**Blocked by:** None.

**Layers:** AI evals, judge prompt, worker configuration, offline tests, example
environment configuration, and eval guidance.

**Modularity:** One evaluator owns applicable rubric selection, single-request
execution, complete response validation, and conversion to named scores/reasons.
Reporting owns dataset execution and aggregates. Runners supply configuration and
rubrics without managing judge internals. Use Pydantic AI and structured Pydantic
output; follow local instructions before editing. Keep deterministic checks and
production generation behavior unchanged.

**Status:** ready-for-agent.

**Acceptance Criteria:**

- A successfully generated question or feedback case makes exactly one judge provider
  attempt and retains every applicable existing score name and explanation.
- Failed generation makes no judge request. General/technical feedback omits
  `knowledge_accuracy` from requests and results; its aggregate is knowledge-only.
- Missing, extra, duplicate, nonfinite, out-of-range, or otherwise malformed results
  fail the whole evaluator without partial scores. Provider errors also fail visibly.
  Neither path retries or uses fallback, including transport-level retries.
- `EVAL_JUDGE_MODEL` overrides the default independently of generation model settings
  and report CLI model overrides. Metadata identifies the actual judge model.
- Native reports, saved comparison reports, Logfire aggregates, raw generation output,
  evaluator failures, and available judge usage/costs remain observable.
- Eval guidance and environment examples describe configuration and strict failures.

**Verification:**

Use red–green–refactor at observable evaluator/report interfaces. Fake provider boundaries
and count actual attempts for successful, malformed, and retryable HTTP-error responses.
Cover both suites and all feedback scopes, report persistence, configuration isolation,
generation failure, and cost capture without external requests. Extend existing tests
or add focused judge tests as needed.

```bash
docker compose run --rm ai pytest -m "not db" tests/test_interview_evaluators.py tests/test_eval_reports.py tests/test_eval_lifecycle.py tests/test_eval_report_costs.py tests/test_eval_report_cost_edges.py
docker compose run --rm ai pytest tests/test_schema_dependencies.py
docker compose run --rm ai ruff check .
```

Include new focused test files in these checks. Actual red/green and broader results:
not run.

**Progress:** No worker assigned; branch/worktree, starting base, and resulting commits
pending. No implementation started. Worker must not edit the combined tickets file,
plan delivery record, Kanban board, integration branch, or PR.

## 02 — Validate consolidated judging against live interview cases

**What to build:** Run both interview eval suites with the integrated judge and retain
reviewable reports. Check the real request counts, rubric coverage, model identity,
errors, and usage. Record quality observations and any external execution limitations.

**Blocked by:** 01 integrated and verified.

**Layers:** AI eval execution and saved report artifacts. The coordinator owns delivery
record updates and integration of evidence.

**Modularity:** Exercise the existing report CLI and production eval entry points.
Do not introduce another runner, duplicate judging logic, or change rubrics to improve
scores. Material scope/design changes return for approval.

**Status:** ready-for-agent (waiting for dependency).

**Acceptance Criteria:**

- Both live suites run using the configured independent judge; reports retain individual
  scores/reasons, raw generation outputs, judge metadata, and available usage/costs.
- Evidence confirms one judge attempt per successfully generated case, none for failed
  generations, and knowledge-only accuracy scoring. Distinguish generation/screening
  calls from judge requests when inspecting counts.
- Inspect explanations for scope, grounding, usefulness, and knowledge correctness;
  record quality concerns without treating subjective scores as automatic pass gates.
- Failures or missing credentials/model access/pricing are reported truthfully and
  saved where possible. Unrun or failed checks never count as passed.

**Verification:**

```bash
docker compose run --rm ai python -m evals.run_report interview_questions
docker compose run --rm ai python -m evals.run_report interview_feedback
```

Use the existing output directory convention and inspect actual saved evidence.
Live provider charges are authorized by the confirmed scope. No browser automation.
Actual commands/results: not run.

**Progress:** No worker assigned; branch/worktree, starting base, and resulting report
commits pending. No implementation started. External blockers: none established.

## Integration and handoff

The coordinator integrates sequentially, verifies all plan acceptance criteria, and
records actual results. After checks, run two fresh blind reviews concurrently against
the same fixed base/head, one for correctness and one for design, following the workflow.
Resolve supported findings, repeat reviews after substantial fixes, and create a PR for
human review and report inspection. Do not merge or remove the Kanban item.
