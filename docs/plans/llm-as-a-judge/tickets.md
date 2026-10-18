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

**Status:** implemented.

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

Actual red: original reporting made four provider calls and failed the new one-call
question regression. Green: worker passed 80 tests; coordinator repeated the full
focused command with `tests/test_interview_judge.py` and schema dependencies included:
80 passed in 9.17s. HTTP success/429/500 each made one transport attempt. Changed-file
Ruff and diff checks pass. Full Ruff has four pre-existing errors reproduced on base
48195a0: BLE001 in conversation_logging/__init__.py:102,133, I001 and SIM117 in
tests/test_conversation_logging_reliability.py. Initial setup failures were corrected
and are not counted as red evidence.

Review fix: pricing test reproduced 1 failure/4 passes, then 30 focused tests passed
after explicitly limiting the price requirement to production billing models.
Worker fix `d492b6e` integrated as `8adeb42`. Coordinator's final focused command
including pricing: 85 passed in 9.52s (four dependency deprecation warnings).

**Progress:** Assigned to `single_judge` on `work/llm-as-a-judge-01-single-judge`,
worktree `/tmp/careergrind-llm-judge-01`, starting base `48195a0`. Worker commit
`d2fc7c8` integrated as `cd5ef42`; acceptance criteria verified offline.
Worker must not edit the combined tickets file,
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

**Status:** implemented.

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
Actual commands used `docker run --rm --env-file` with the existing local AI environment,
explicit `EVAL_JUDGE_MODEL=openai:gpt-6.1-sol`, and worker source/report mounts. Both
CLI suites ran once. Questions exit 0: 13 generated cases, 13 judges, no errors.
Feedback exit 1: 12 generated cases, 12 judges, no evaluator failures; one Jev timeout
prevented generation and therefore judging. Knowledge accuracy appears only on the
three successfully generated knowledge cases. Scores/reasons/metadata/usage retained.
Unknown judge prices keep estimates incomplete. Existing rubric dictionary telemetry
warnings recorded; report configuration retains rubrics. No reruns.

**Progress:** Assigned to `live_validation` on `work/llm-as-a-judge-02-live-validation`,
worktree `/tmp/careergrind-llm-judge-02`, base `cd5ef42`. Worker report commit `5d40c7e`
integrated as `54633dc`. Evidence: `docs/evals/llm-as-a-judge-20261018.md` and linked
full synthetic reports. External limitation: one Jev timeout, not a judge failure.

## Integration and handoff

The coordinator integrates sequentially, verifies all plan acceptance criteria, and
records actual results. After checks, run two fresh blind reviews concurrently against
the same fixed base/head, one for correctness and one for design, following the workflow.
Resolve supported findings, repeat reviews after substantial fixes, and create a PR for
human review and report inspection. Do not merge or remove the Kanban item.
