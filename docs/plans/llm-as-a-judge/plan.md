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
- Phase: both tickets integrated and verified; final blind reviews clean; publication
  blocked pending explicit approval of the GitHub upload after automatic review rejection.
- Requirements: user selected one attempt/report failures and `gpt-6.1-sol`, then
  explicitly confirmed the full scope on 2026-10-18.
- Plan approval: user said “approved” on 2026-10-18. Approved file SHA-256 before
  delivery-record updates: `b3cfa758ecb277fa3ca9fc88d7ab83cbffa8737c4ae692901ded14e6737d7a8a`.
- Breakdown approval: user said “approved” on 2026-10-18. Approved tickets SHA-256:
  `718fa02bd3432e58d1ab253f518c3607621b24ede83a4041854350d8a2a5f78c`.
- Planning commit and integration base: `48195a0`. Initial integration head: `48195a0`.
- Integration branch: `work/llm-as-a-judge`, worktree `/tmp/careergrind-llm-judge`.
- Ticket 01: implemented on `work/llm-as-a-judge-01-single-judge`, worktree
  `/tmp/careergrind-llm-judge-01`, starting base `48195a0`; worker commit `d2fc7c8`
  integrated as `cd5ef42`. All acceptance criteria verified offline.
- Ticket 02: assigned to `live_validation`, branch `work/llm-as-a-judge-02-live-validation`,
  worktree `/tmp/careergrind-llm-judge-02`, starting base `cd5ef42`; implemented.
  Worker evidence `5d40c7e` integrated as `54633dc`.
- Git and Docker require sandbox escalation; both authorized operations succeeded.
- Exploration: interview runners/reporting, settings, native telemetry/cost capture,
  report CLI, and relevant offline tests inspected. Checkout is `master`, initially clean.
- Verification: baseline 51 tests passed. Integrated focused judge/report/lifecycle/cost
  suites plus schema dependencies: 80 passed in 9.17s. Changed-file Ruff passes.
  Full Ruff has four pre-existing findings reproduced on base `48195a0`; see tickets.
  Pricing review fix `d492b6e` integrated as `8adeb42`; final focused suite including
  pricing: 85 passed in 9.52s with four dependency deprecation warnings.
- First blind review snapshot: base `48195a0`, head `cd5ef42`. Correctness: 80 tests
  passed; `test_model_prices.py` reproduced one failure (4 pass), because its model
  setting scan includes the new eval-only model. Supported P2 finding; test scope fix
  delegated to the implementation worker. No other actionable correctness findings.
  Design: 59 tests passed, diff check passed, no actionable findings.
- Live questions: 13 cases, zero errors, exactly 13 judge calls. Feedback: 12 generated
  cases, 12 judge calls, no evaluator errors; one Jev timeout before generation, CLI exit 1.
  No reruns. Full evidence and limitations: `docs/evals/llm-as-a-judge-20261018.md`.
- Coordinator acceptance check: criteria 1–3 verified through native report/provider
  tests and live counts; criterion 4 through default/env/comparison tests and live metadata;
  criterion 5 through native cost/report tests and saved live reports; criterion 6 through
  unchanged generation/deterministic code and focused tests. Judge pricing remains unknown;
  existing rubric-dictionary span warning affects telemetry attributes, not saved metadata.
- Final blind review snapshot: original base `48195a0`, candidate `54633dc`; fresh
  correctness reviewer: 85 tests passed, no actionable findings. Fresh design reviewer:
  64 tests passed, no actionable findings. Both diff checks passed. No production behavior changed
  since the live runs; only pricing test scope and report evidence were added.
- Publication scope: remote master `6930b8e` is behind two unrelated local planning
  commits (`25d45c5`, `9a8616f`). Rebase only this feature's commits onto remote master
  before publishing, preserving local master and those unrelated plans. No code changes
  result; original review snapshots remain recorded above.
- Publication rebase completed: planning base `4593ce0`, implementation `dbe85b0`,
  pricing fix `64027ad`, live evidence candidate `c87824d`, verification record `f78b478`.
  `git diff --exit-code 54633dc HEAD -- services docs/evals` passed: reviewed code,
  tests, configuration, and live evidence are byte-for-byte unchanged. Final remote-base
  diff contains only intended feature files; diff whitespace check passes. No additional
  review or test round is needed for the history-only rebase and delivery-record edits.
- PR and manual QA: not started.
- Publication blocker: automatic approval review rejected pushing the feature branch to
  `https://github.com/JarrodNB/resume_project.git`, stating private code/eval artifacts
  need trusted approval for this exact payload and destination. No push or PR occurred.
  Ask the user to authorize uploading `work/llm-as-a-judge`, including the implementation,
  tests, approved workflow records, and synthetic eval reports, and opening its PR.
- User explicitly authorized PR creation and worktree cleanup on 2026-10-18. Git push
  then failed because CLI HTTPS credentials are unavailable. Publishing the identical
  reviewed file tree through the connected GitHub integration instead; verify remote
  tree identity before removing this feature's temporary worktrees. Preserve branches.
