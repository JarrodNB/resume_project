# LLM as a judge

## Problem Statement

Interview question evals currently make four judge calls per generated case. Feedback
evals make five calls, or six for knowledge cases. Each rubric creates a separate
`LLMJudge`, and judges use the model under evaluation. This adds repeated work and
changes the judge when comparing generation models.

## Human Decisions

Confirmed on 2026-10-18:

- One judge attempt per successfully generated case. Malformed output and provider
  failures become evaluator errors; no judge retries or fallback.
- A separately configurable judge model defaults to `openai:gpt-6.1-sol`.
- Preserve individual scores and reasons, knowledge-only accuracy scoring, deterministic
  checks, native reports, Logfire reporting, and captured judge usage/costs.
- Scope is the two interview eval suites. Production generation behavior stays unchanged.
- Verify offline with fake providers, then run both interview suites against live providers.

The user confirmed this scope. Written plan approval is still pending.

## User Stories

- As a developer running interview evals, I get all applicable subjective scores from
  one judge request for each generated case.
- As a developer comparing generation models, I use the same independently configured
  judge and can inspect its scores, explanations, errors, and usage in reports.

## Solution

Replace the per-rubric interview judges with one cohesive multi-rubric evaluator. It
selects the applicable rubrics using trusted case scope, submits inputs and generated
output as data in one request, validates the complete structured response, and returns
the existing named scores and reasons through Pydantic Evals.

For nonknowledge feedback, omit `knowledge_accuracy` from both the request and returned
scores. Its aggregate remains knowledge-only. Keep the existing rubric wording and
0–1 score convention. A missing, unexpected, duplicate, nonfinite, out-of-range, or
otherwise malformed rubric result fails the evaluator rather than producing partial
scores or another model request. Each requested rubric must have an explanation.

Cases whose generation fails make no judge request. Low subjective scores remain
review signals; evaluator errors retain the existing nonzero runner failure behavior.

## Implementation Decisions

- Keep judge execution, applicable rubric selection, response validation, and conversion
  to named evaluation results behind one evaluator interface in the evals package.
- Use a Pydantic AI agent and Pydantic structured output. Keep judge instructions in
  the prompts package, following its local instructions. Treat case data as untrusted
  content and retain the existing instruction to never follow embedded directives.
- Add `eval_judge_model` configuration, mapping to `EVAL_JUDGE_MODEL`, defaulting to
  `openai:gpt-6.1-sol`. Document it in the example environment file and eval guidance.
  Generation model overrides must never change this setting.
- Explicitly disable agent output retries, provider transport retries, and fallback for
  the judge. Bound execution to one model request; use the configured LLM timeout.
  Verify the actual SDK/provider behavior rather than relying on an agent retry flag alone.
- Keep deterministic evaluators and generation configuration as they are. No new judge
  calls in suites that currently use deterministic checks.
- Retain existing report score names, explanations, raw generation output, error capture,
  and knowledge-only averages. Record the actual independent judge model and rubric
  configuration in run metadata. Preserve tracing and native cost capture for successful
  and unsuccessful judge requests where usage is available.

## Testing Decisions

Test through the evaluator and real Pydantic Evals reports with fake model/provider
boundaries. Count actual provider attempts, including retryable HTTP failures; counting
only evaluator invocations cannot prove the one-attempt requirement.

Existing seams include `test_interview_evaluators.py` for report/error behavior,
`test_eval_reports.py` for runner metadata and comparison isolation, and
`test_eval_report_costs.py` / `test_eval_report_cost_edges.py` for captured requests and
costs. Extend these or add focused judge tests as responsibilities warrant.

Cover question, general feedback, technical feedback, and knowledge feedback cases;
all applicable scores/reasons; scope-based omission; malformed responses; retryable
provider failure; generation failure; independent judge configuration during model
comparisons; and preserved report/Logfire aggregates and captured usage. Behavior
changes use red–green–refactor. Do not assert private sequencing or prompt formatting.

## Architecture Decisions

The evals package owns subjective evaluation. Production agents, queue contracts,
Rails data ownership, and task retry policies are unaffected. Keep reporting orchestration
separate from judge behavior; callers supply rubrics and configuration without managing
judge request sequencing or response validation. No new schema/queue contract or ADR is
needed for this scoped change.

## Rollout Risks and Other Risks

- One shared response can correlate rubric judgments; retain distinct rubrics and reasons
  and inspect live reports for lost distinctions.
- Strict single attempts expose transient failures that retries previously hid. Preserve
  visible errors and saved failure reports so a human can decide whether to rerun a suite.
- The stronger judge may change scores and per-request costs. Record actual model/usage;
  do not promise a cost reduction or compare old and new scores as identical calibration.
- Judge model access, credentials, or pricing information may be unavailable. Record
  those limitations honestly; unknown cost must remain unknown rather than zero.

## Observable Acceptance Criteria

1. Each successfully generated interview case makes exactly one judge provider attempt,
   returning all applicable named scores with reasons. Failed generation makes none.
2. General/technical feedback neither requests nor emits `knowledge_accuracy`; knowledge
   feedback includes it, and its average includes knowledge cases only.
3. Invalid judge responses and provider failures cause one evaluator failure without
   retries, fallback, partial scores, or fabricated passing results. Runners fail visibly.
4. The judge defaults to `openai:gpt-6.1-sol`, accepts an environment override, and remains
   independent of generation model defaults and comparison overrides.
5. Native/Markdown reports and Logfire retain separate scores/reasons, raw generation
   output, accurate judge metadata, and request usage/cost capture where available.
6. Existing deterministic checks and production generation behavior remain unchanged.

## Dependencies and Verification

No dependency upgrade is planned. Inspect installed Pydantic AI/Evals APIs and applicable
local instructions before implementation; adapt within the approved behavior.

Run from the implementation checkout, per `docs/testing.md`:

```bash
docker compose run --rm ai pytest -m "not db" tests/test_interview_evaluators.py tests/test_eval_reports.py tests/test_eval_lifecycle.py tests/test_eval_report_costs.py tests/test_eval_report_cost_edges.py
docker compose run --rm ai pytest tests/test_schema_dependencies.py
docker compose run --rm ai ruff check .
docker compose run --rm ai python -m evals.run_report interview_questions
docker compose run --rm ai python -m evals.run_report interview_feedback
```

Include any new focused test files in verification. Confirm report CLI options before
live execution and retain generated reports using its existing output convention. Live
evals incur provider charges and are authorized by the confirmed scope. Record actual
commands, request counts, scores, errors, usage, and limitations; do not treat offline
fakes as evidence of live model quality. No browser automation.

Manual QA: inspect both saved reports for per-rubric explanations, knowledge-only
accuracy, judge model identity, and request accounting. Assess whether consolidated
judgments still distinguish grounding, usefulness, scope, and subject correctness.

## Out of Scope

New subjective checks in other suites, changed rubric meaning, generation prompt/model
changes, production fallback/retry changes, UI work, queue work, and automatic acceptance
thresholds for subjective scores.

## Additional Notes

Leave the Kanban item until explicit human completion confirmation. Preserve unrelated
changes. Approved planning artifacts will be committed on `master` after separate plan
and ticket-breakdown approvals, before worktree implementation.

## Delivery Record

- Source: `KANBAN.md`, “LLM as a judge”; user supplied the same item in this chat.
- Phase: plan and breakdown approved; prepare planning commit and implement ticket 01.
- Requirements: user selected one attempt/report failures and `gpt-6.1-sol`, then
  explicitly confirmed the full scope on 2026-10-18.
- Plan approval: user said “approved” on 2026-10-18. Approved file SHA-256 before
  delivery-record updates: `b3cfa758ecb277fa3ca9fc88d7ab83cbffa8737c4ae692901ded14e6737d7a8a`.
- Breakdown approval: user said “approved” on 2026-10-18. Approved tickets SHA-256:
  `718fa02bd3432e58d1ab253f518c3607621b24ede83a4041854350d8a2a5f78c`.
- Planning commit: none. Integration base/head: not created.
- Intended integration branch: `work/llm-as-a-judge`; worker branches not created.
- Exploration: interview runners/reporting, settings, native telemetry/cost capture,
  report CLI, and relevant offline tests inspected. Checkout is `master`, initially clean.
- Verification: documentation only so far; application tests and paid evals not run.
- Blind reviews, PR, and manual QA: not started.
