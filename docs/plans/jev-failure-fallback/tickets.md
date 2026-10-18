# JEV failure fallback tickets

Draft breakdown for human approval. Based on the approved plan in `plan.md`.
Implementation has not started. This is one vertical slice because fallback decisions,
deadlines, and per-model cost accounting must ship together to provide correct recovery.

## 01 — Recover from JEV failures with bounded, accounted fallback screening

**What to build:** Required-input AI tasks can continue after a JEV timeout or ordinary
provider failure when GPT-5 Nano screens the same protected input successfully. Preserve
blocking, unavailable results, and actual costs across both screening models.

**Blocked by:** None. Human breakdown approval and the planning commit are required before
the worker starts.

**Layers:** AI screening policy, classifier agents/prompts/output types, worker settings
and existing usage plumbing as needed, offline tests, screening quality evals, and affected
technical documentation/instructions. No Rails, frontend, database, or queue schema changes.

**Modularity:** Keep sync/async screening entry points as the small decision interface.
Screening owns JEV timeout, fallback selection, boolean/confidence interpretation, chunk
policy, coverage, and failure handling. Handlers must not sequence providers or select
fallback rules. Keep each Pydantic AI agent focused on one classifier with its instructions
in `prompts/`. Neither classifier recursively invokes the generative input guardrail.
Use concrete model request observation for costs; do not report mixed tokens as JEV usage.
Use real screening and task interfaces in tests, with fakes only at external boundaries.

**Status:** ready-for-agent (not dispatchable until breakdown approval and planning commit).

**Acceptance Criteria:**

1. Each JEV request receives an application-enforced maximum of three seconds, bounded
   earlier by the remaining overall deadline. The async provider is cancelled on timeout.
2. JEV timeout, provider error, or invalid provider response invokes the configured screening
   fallback, default `openai:gpt-5-nano`, on the same protected chunk within remaining time.
3. A successful JEV decision never invokes fallback. JEV's existing threshold remains;
   Nano uses structured booleans, blocks on either positive answer, and cannot overturn
   a JEV rejection. Do not manufacture confidence margins for Nano.
4. Missing `TYPESAFE_API_KEY` calls neither classifier. Both-provider failure, invalid
   fallback output after bounded validation attempts, and exhausted time remain unavailable.
   Usage-limit failures and external cancellation propagate without fallback.
5. All chunks must pass with existing overlap, masking, character caps, phrase policy, and
   execution-local exact coverage. Each new chunk starts with JEV. Sync and async paths
   share the policy; callers gain no fallback sequencing responsibility.
6. At least one real required-input task completes after recovery, and blocked/unchecked
   required input cannot reach generation. Approved assembled prompts are not rescreened.
7. Queued task reports include Nano's actual tokens and estimated cost exactly once under
   its actual model. Retain completed JEV chunks and completed fallback responses even if
   later screening, validation, or generation fails. Output-validation retries count each
   concrete response once. Requests that fail without usage preserve incomplete accounting;
   compatibility aggregates cannot double count observed requests.
8. A dedicated fallback eval exercises synthetic benign and attack cases directly using
   the production boolean policy. Keep JEV confidence evals meaningful and distinguish
   provider outages from successful detection. Update docs and scoped guidance accordingly.

**Verification:**

- Follow the workflow's red-green-refactor instructions, one observable behavior at a time.
  Record actual failing commands and reasons before the production fix, then passing results.
- Extend existing examples in `test_screen_user_text.py`, `test_screening_session.py`,
  `test_prompt_guardrail.py`, `test_run_limits.py`, and `test_task_usage_providers.py` /
  `test_task_usage_guardrails.py`; use additional focused files where cohesive.
- Through `process_task_message` and fake model providers, assert the published concrete
  Nano cost/tokens, retained JEV usage, no duplicate totals, and incomplete-usage marker.
- Use a suspended async fake and short test budgets to prove cancellation/recovery and
  overall deadline enforcement; separately verify the three-second production limit.
- Run focused offline tests, then `docker compose run --rm ai pytest -m "not db"` and
  `docker compose run --rm ai ruff check .` from the implementation checkout. Use the
  documented explicit worktree mount alternative if a compatible image is available.
- Run `docker compose run --rm ai python -m evals.run_user_text_screen_evals`,
  `docker compose run --rm ai python -m evals.run_prompt_guardrail_evals`, and the new
  fallback runner. Record actual quality results or specific credential/network blockers.
  These checks use synthetic data and may incur provider charges.
- No browser automation. Manual QA stays with the human at PR handoff.
- Actual red/green, broader checks, and paid eval results: not run yet.

**Progress:**

- Assigned worker: none. Writer must use its own worktree and branch.
- Proposed branch: `work/jev-failure-fallback-01-screening-recovery`.
- Starting base: current integration head after the approved planning commit; not created.
- Resulting commits: none. Coordinator integrates and verifies before marking implemented.
- Worker must not edit this file, the plan, Kanban, integration branch, or PR.
- Coordinator then runs acceptance checks and two fresh blind reviews of one fixed full diff,
  resolving supported findings before a PR for human QA.
- Environment concern: an initial unprivileged Docker inventory failed on socket permission.
  Necessary Docker commands may need sandbox escalation; record actual outcomes.
