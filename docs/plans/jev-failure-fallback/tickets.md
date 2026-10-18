# JEV failure fallback tickets

Breakdown approved by the user ("confirmed") for SHA-256
`84c0b2b71e59a79c5b49dd02538ff63c024f22f5ca3af6bf9551023a234e45fc`.
Based on the approved plan in `plan.md`. This is one vertical slice because fallback decisions,
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

**Status:** implemented.

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
- Actual TDD: outage regression first failed with unchecked, then passed after fallback;
  mixed-provider regression exposed incorrect token attribution, then passed with separate
  model usage. JEV outage eval first returned success, then failed correctly after repair;
  native evaluation success exposed `.value` handling and passed after correction.
- Worker full offline suite: 586 passed, 9 deselected (93.53s). Coordinator integrated suite:
  96 passed (16.56s), using the nine focused files listed in the plan delivery record.
- Full Ruff: exactly four confirmed baseline violations in unchanged files
  `conversation_logging/__init__.py` (two BLE001) and
  `tests/test_conversation_logging_reliability.py` (I001, SIM117). Ruff excluding those two
  files passed; full diff whitespace check passed.
- Live guardrail: 7/7 correct, passed. Final fallback: 13 completed correct, one provider
  timeout, failed suite. Direct JEV: 3 completed correct, 11 application timeouts, failed
  suite. Every fallback case completed correctly across the two v2 runs, but no single
  standalone all-cases success is claimed. See plan for limitations.

**Progress:**

- Assigned worker: `screening_recovery`, worktree `.worktrees/jev-fallback-01`.
- Branch: `work/jev-failure-fallback-01-screening-recovery`.
- Starting base: planning commit `cd521bb561d1ba51b0122ba402871e6b68dd250c`.
- Resulting worker commit: `db82adfc8b3593c87c936bcee3cbc1326decf253`.
  Integrated as `28173b217054f78f4e22e0790ca9790f2ccd2c0b`; coordinator verified before
  marking implemented. All eight acceptance criteria checked against code and tests.
- Worker must not edit this file, the plan, Kanban, integration branch, or PR.
- Coordinator then runs acceptance checks and two fresh blind reviews of one fixed full diff,
  resolving supported findings before a PR for human QA.
- Completed reviews on base `91f5a4f5e4f9cc05eab4d419b741055e0ebc0635` through candidate
  `28173b217054f78f4e22e0790ca9790f2ccd2c0b`: correctness and design both report no actionable
  findings. Correctness checks 62 + 140 passed; design checks 38 + 57 passed. No source fixes.
- Environment concern: an initial unprivileged Docker inventory failed on socket permission.
  Necessary Docker commands may need sandbox escalation; record actual outcomes.
