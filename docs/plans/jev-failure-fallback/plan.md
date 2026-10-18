# JEV failure fallback

Status: ticket 01 integrated and verified; both blind reviews clean; preparing PR handoff.

## Problem Statement

A JEV timeout can stop an entire AI task. Screening currently shares the much longer
generation deadline, and required input cannot proceed when JEV is unavailable. A brief
screening outage should have a second screening path without letting unchecked text reach
the writing or parsing model.

## Human Decisions

The user selected these behaviors in this chat:

- Use GPT-5 Nano as a safety classifier after a JEV timeout or error.
- Limit each JEV request to three seconds, rather than limiting all chunks together.
- Keep a missing `TYPESAFE_API_KEY` unavailable; do not invoke the fallback in that case.
- Maintain a slim interface with useful behavior hidden inside a deep module.

The user confirmed the plan and specifically reinforced cost tracking for the failover
call. Each concrete provider request must use the existing accounting path, including
fallback responses before a later block, failure, or output-validation retry.

## User Stories

- As a user, I can finish an AI task during a JEV outage if the fallback successfully
  screens all required input.
- As a user, I still receive an unavailable result if neither screening provider succeeds,
  rather than having unchecked input used for generation.

## Solution

For each chunk, try JEV with a deadline of the smaller of three seconds and the remaining
overall deadline. On an ordinary provider error, timeout, or invalid provider response, ask
GPT-5 Nano the same two safety questions about the same protected chunk. A successful JEV
decision is final for that chunk, including a rejection; fallback cannot overturn it.

The fallback uses structured boolean answers. Either positive answer blocks; both must be
negative to allow. Do not invent JEV confidence margins for a generative model. JEV keeps
its existing confidence policy. If fallback fails or time runs out, the source is unchecked.
Existing required/optional input handling determines whether the task stops or omits it.

Preserve size limits, phrase checks, contact masking, overlapping chunks, and exact
execution-local coverage. Every chunk must pass. Each new chunk starts with JEV; no
execution-wide circuit breaker is added. Missing JEV credentials return unchecked without
calling either provider. Usage-limit failures and external cancellation do not trigger
fallback or become an ordinary unchecked result.

## Implementation Decisions

- Keep `screen_user_text` and its async counterpart as the callers' screening interface.
  The screening module owns deadlines, provider selection, decision normalization, chunk
  processing, coverage, and failures. Handlers do not sequence classifier calls.
- Keep the JEV agent focused on JEV. Add a focused Pydantic AI fallback classifier with
  versioned instructions and structured output for the same two questions.
- Exempt both screening classifiers from recursive input screening. Their prompts treat
  input as data and never perform the requested work.
- Give screening its own fallback-model setting, defaulting to `openai:gpt-5-nano`, so a
  change to writing-model fallback does not silently change the safety classifier.
- Enforce the three-second JEV limit in application code across synchronous and async use.
  Fallback receives only the remaining overall budget. Existing request/token/tool limits
  continue to apply to classifier agent runs.
- Retain actual model usage at the existing concrete-request accounting seam, including
  completed chunks before later failures. A timed-out request with no usage stays unknown.
  Do not attribute mixed-model tokens to JEV or double count compatibility aggregates.
  Adjust internal usage plumbing only where necessary; keep callers' decision API small.
- Update affected scoped instructions and the AI safety architecture guide. No queue,
  GraphQL, database, or frontend contract change is planned.

## Testing Decisions

Use TDD with fake providers at the model boundary and real screening policy. Existing
examples include `test_screen_user_text.py`, `test_screening_session.py`,
`test_prompt_guardrail.py`, `test_run_limits.py`, and `test_task_usage_providers.py`.

Exercise cancellation and timeout using a controllably suspended async provider and short
test deadlines. Check the production three-second configuration separately; avoid slow,
fragile tests that require waiting three seconds for each case.

Cover JEV success/block without fallback, timeout/error recovery, fallback allow/block,
both-provider failure, invalid fallback output, missing-key behavior, shorter overall
deadlines, limit propagation, multi-chunk outcomes, sync/async parity, and retained usage.
Verify at least one required-input task completes after recovery and that blocked or
unchecked required input never reaches its generative provider.

Reuse synthetic screening cases for a dedicated fallback quality evaluation. Keep JEV
confidence evaluation distinct from fallback boolean decisions. Run the existing screening
and prompt-guardrail evals plus fallback cases; outages must count as errors, not successful
attack detection. Paid evaluations require working configured credentials.

## Architecture Decisions

Screening remains the owner of whether untrusted input may enter generation. Provider
details stay behind that decision interface. This is a local extension of the current
screening module, not a generic provider framework. Record the changed failure policy in
`docs/architecture/ai-safety-and-usage.md`; a separate system-wide ADR is unnecessary.

## Rollout Risks and Other Risks

- Nano may classify differently from JEV. Synthetic benign and attack cases must exercise
  the fallback directly before handoff; quality scores are evidence, not a detection guarantee.
- Three seconds may cause additional fallback calls during slow but healthy JEV responses.
  Fallback costs and latency are bounded by the existing task deadline and usage limits.
- A provider may charge for a cancelled JEV request without returning token usage. Preserve
  the existing incomplete-usage marker rather than treating the call as free.
- The fallback adds another model call but must not recurse through the input guardrail.
- Missing JEV credentials deliberately remain a task blocker for required input.

## Observable Acceptance Criteria

1. A JEV call is cancelled after at most its three-second application timeout, or earlier
   when the overall deadline is shorter, and fallback can run within remaining time.
2. Ordinary JEV failures invoke Nano on the same protected chunk; a benign fallback result
   allows required-input generation to proceed.
3. A JEV rejection never invokes fallback. A fallback rejection prevents generation.
4. Both-provider failure or exhausted budget cannot approve the source. Missing JEV
   credentials call neither provider and retain the unavailable result.
5. Usage-limit failures propagate; cancellation is preserved. Neither invokes fallback.
6. Long sources retain overlap and require every chunk to pass. Earlier usage survives a
   later rejection/failure. Cached decisions are confined to the current execution.
7. Sync handlers and async input guards apply the same recovery policy without caller-owned
   fallback sequencing, recursive screening, or duplicate screening of approved prompts.
8. Published task usage records concrete models once and preserves unknown charges.

## Dependencies and Verification

No new external service or package dependency is expected. Use existing Docker tooling:

```bash
docker compose run --rm ai pytest -m "not db" tests/test_screen_user_text.py tests/test_screening_session.py tests/test_prompt_guardrail.py tests/test_run_limits.py tests/test_task_usage_providers.py tests/test_task_usage_guardrails.py
docker compose run --rm ai pytest -m "not db"
docker compose run --rm ai ruff check .
docker compose run --rm ai python -m evals.run_user_text_screen_evals
docker compose run --rm ai python -m evals.run_prompt_guardrail_evals
```

Include newly added focused test files and the fallback eval command once implemented.
Use an explicitly mounted compatible development image for offline worktree checks when
appropriate, as documented in `docs/testing.md`.

Human QA: use synthetic input to complete a normal task, then repeat with JEV deliberately
unavailable while credentials are still present. Verify fallback recovery and usage, then
verify a blocked input and a both-provider outage cannot proceed. No browser automation.

## Out of Scope

Changing JEV's detection threshold, missing-key recovery, bypassing screening, replacing JEV
as primary, persistent approvals, circuit breakers, new queue contracts, and unrelated
architecture refactors.

## Additional Notes

Leave the Kanban item on the board through PR review and human QA. Only explicit human
completion confirmation authorizes removing it.

## Delivery Record

- Source: `KANBAN.md`, **Need fallback for JEV failure** (already marked IP).
- Phase / next action: integrated acceptance checks and both blind reviews passed; open
  PR for human QA. Do not merge, deploy, or clear the board without human instruction.
- Human approvals: user said "confirmed, just make sure we are tracking the costs for the
  failover call like we should be doing everywhere" for plan SHA-256
  `cce0cf8441b92b67a2812af2c477271e935ac35d0d44561e48b49a1a5695dd87`.
  The cost reminder reinforces the existing accounting scope. User then said "confirmed"
  to breakdown SHA-256 `84c0b2b71e59a79c5b49dd02538ff63c024f22f5ca3af6bf9551023a234e45fc`.
- Planning commit on `master`: `cd521bb561d1ba51b0122ba402871e6b68dd250c`.
- Integration branch: `work/jev-failure-fallback`; base
  `cd521bb561d1ba51b0122ba402871e6b68dd250c`; candidate head
  `28173b217054f78f4e22e0790ca9790f2ccd2c0b`; checkout `.worktrees/jev-fallback-integration`.
- Ticket 01 implemented: worker `screening_recovery`, branch
  `work/jev-failure-fallback-01-screening-recovery`, checkout `.worktrees/jev-fallback-01`,
  starting base `cd521bb561d1ba51b0122ba402871e6b68dd250c`.
  Worker commit `db82adfc8b3593c87c936bcee3cbc1326decf253` integrated as
  `28173b217054f78f4e22e0790ca9790f2ccd2c0b`.
- Planning artifacts are ignored by `/docs/plans/` in `.gitignore`; explicitly stage only
  the approved feature artifacts when making the required planning commit on `master`.
- Verification: worker final offline suite 586 passed, 9 deselected (93.53s).
  Coordinator integrated checks: 96 passed (16.56s), covering recovery, screening/session,
  prompt guardrail, fallback eval, provider/task accounting, run limits and schema direction.
  All Docker offline checks used the explicitly mounted worktree, `--network none`, and
  `OPENAI_API_KEY=offline-test-key`. Diff whitespace check passed. Full Ruff has four
  independently reproduced baseline failures in unchanged conversation-logging files;
  worker Ruff excluding those two files passed. Baseline offline suite: 560 passed.
  Initial read-only `docker image ls` failed with permission denied on Docker's socket.
  Escalated Docker image inventory succeeded; `resume_project-ai:latest` is available.
- Live synthetic checks: final guardrail suite 7/7 correct, passed. Final Nano 13 completed
  cases all correct, one provider timeout, suite failed. Prior v2 Nano run also had 13
  correct completed cases with a different timeout; every case completed correctly across
  these two runs, but no fully available standalone run is claimed. Direct JEV: 3 completed
  cases correct, 11 three-second timeouts, suite failed. Initial fallback false positives
  were corrected through versioned prompt framing and reasoning, without changing labels.
  No further paid retries planned. JEV eval now exits nonzero on case errors/incorrect decisions.
- Acceptance audit: criteria 1–5 covered by real provider-boundary timeout, same-input,
  allow/block, missing-key, deadline, usage-cap and cancellation tests. Criterion 6 covered
  by mixed-chunk and existing session/overlap tests. Criterion 7 covered by real required
  parse-job completion with no extra screen and direct async guard tests. Criterion 8
  covered by queued concrete-response cost assertions, including validation retries,
  blocked/invalid fallback and incomplete usage. Coordinator inspected these paths.
- Blind reviews: base `91f5a4f5e4f9cc05eab4d419b741055e0ebc0635` (remote master before
  planning), head `28173b217054f78f4e22e0790ca9790f2ccd2c0b`. Fresh correctness and design
  agents received this same snapshot without requirement artifacts or implementation reports.
- Correctness review: no actionable findings; 62 focused tests plus 140 affected tests
  passed offline. One initial invocation named a nonexistent test file and collected no
  tests; corrected invocation passed. Review whitespace check passed; checkout clean.
- Design review: no actionable findings; 38 focused tests plus 57 affected tests passed
  offline. Review whitespace check passed; checkout clean. Recovery remains cohesive and
  callers consume the decision and per-model usage without managing provider sequencing.
- No source fixes followed these reviews. Subsequent delivery-record/PR metadata edits
  are editorial; inspect the final diff but no new blind-review round is needed.
- PR / manual QA: pending. Provider availability and four baseline lint failures must
  be disclosed in handoff. No browser automation was used.
