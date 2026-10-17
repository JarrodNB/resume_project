# Screen each input once: implementation tickets

Plan and breakdown approvals are recorded in plan.md. Implementation is authorized.
All verification below is intended, not yet run. Writers follow the workflow's
red–green–refactor instructions and use isolated worktrees from the current integration
head. The coordinator records integration and actual results here.

## 01 — Screen resume imports once with execution-scoped chunks

**What to build:** A resume import makes one complete screening pass, using overlapping
chunks for large resumes. Introduce the shared execution-scoped screening mechanism and
agent coverage enforcement through this first complete behavior.

**Blocked by:** None.

**Layers:** AI screening, resume agent/handler, worker execution lifecycle, tests.

**Modularity:** Screening owns decisions, chunking, provenance, and reuse. The execution
boundary owns session lifetime. Agent enforcement must cover direct calls and unknown
history without a caller-controlled bypass. Keep unmigrated agents on their existing
safe path until their migration; do not globally disable the final guard.

**Status:** implemented.

**Acceptance Criteria:**
- An allowed resume fitting one chunk makes one actual Jev request, then generation.
  Larger resumes receive one complete pass with 300-character overlap. Support 2,000-
  and 4,000-character candidates for evaluation; do not select a production default yet.
- Required block, unchecked result, or length rejection prevents generation and retains
  distinct errors. Partial billed calls remain accounted for.
- Identical content/policy reuses the decision within the execution; changes, later
  deliveries, resumed work, and retries start new coverage as appropriate.
- Direct calls are protected; fallback/validation retry does not repeat unchanged checks.
- Concurrent sessions cannot share decisions. Masking and source faithfulness remain.

**Verification:** Focused resume task, screen, prompt guard, guardrail task result, and
task usage tests with fake providers. Add provider-boundary count assertions and tests
for overlap, late-chunk blocks, unavailable checks, fresh executions, history, and isolation.
Run affected lint and offline regressions. Record red/green evidence.

**Progress:** Worker `resume_foundation`, branch
`work/upload-resume-double-calls-jev-01-resume-screening`, worktree `.worktrees/jev-01`,
starting base `8bcedd2`. Commits and actual results pending.

## 02 — Screen pasted and scraped job inputs once

**What to build:** Pasted job parsing screens its source once. Scraped requirement sorting
screens the inputs it sends to the model without duplicate assembled-prompt checks.

**Blocked by:** 01.

**Layers:** AI job agents, handlers/job posting assembly, screening integration, tests.

**Modularity:** Reuse screening's source approval interface. Keep deterministic scraping
independent of screening when no generative request occurs; cover sorting direct calls.

**Status:** implemented.

**Acceptance Criteria:**
- Short allowed pasted ad: one Jev request before parsing; long inputs use shared chunks.
- Every untrusted sorting input is covered once, including scraped/manual text.
- Blocks/unavailability prevent required generation, preserve usage and existing errors.
- No changes to missing-company behavior or queue contracts.

**Verification:** `test_parse_job_posting_handler.py`, `test_scrape_job_handler.py`,
relevant agent/guardrail tests and new provider-count regression cases; affected lint.
Record red/green evidence and actual commands/results.

**Progress:** Unassigned; branch/worktree, starting base, commits, actual results pending.

## 03 — Screen gap-analysis context once

**What to build:** Screen all job/library context consumed by gap analysis once per
execution, preserving optional note omissions and warnings.

**Blocked by:** 01.

**Layers:** AI gap context assembly, gap agent/handler, screening integration, tests.

**Modularity:** Establish cohesive source items and required/optional policy at context
assembly. Screening owns approval and reuse; builders do not manage chunk state.

**Status:** implemented.

**Acceptance Criteria:**
- Saved/imported/manual library fields and job context entering generation are covered.
- Optional unsafe/unchecked items are omitted with warnings; required inputs fail closed.
- Assembled prompts do not repeat approved-input screening. Direct calls remain covered.
- Evidence labels and attached text refer only to retained context; existing size and
  empty-context behavior remains meaningful.

**Verification:** `test_analyze_gaps_handler.py`, `test_build_gap_analysis_prompt.py`,
relevant screening/evidence tests, provider-boundary coverage/count tests, and affected lint.
Record red/green evidence and actual commands/results.

**Progress:** Unassigned; branch/worktree, starting base, commits, actual results pending.

## 04 — Screen tailoring context once

**What to build:** Cover retrieved library items, job context, gap responses, submitted
section edits, and other untrusted section-writing context without duplicate passes.

**Blocked by:** 01.

**Layers:** AI tailoring context/builders, section agent/handler, screening, tests.

**Modularity:** Use the shared screening session at source selection and enforce coverage
at the writer boundary. Preserve retrieval ownership and section approval orchestration.

**Status:** implemented.

**Acceptance Criteria:**
- Every source used by section generation is screened once in this execution.
- Reuse within the execution avoids another pass; the next section task screens reused
  content again. Deterministic contact copying adds no unnecessary model call.
- Optional omissions, rejected edit behavior, grounding, and pause/generation contracts hold.
- Direct writer calls cannot bypass checks, including sections without retrieval.

**Verification:** `test_tailor_resume_handler.py`, relevant tailoring/retrieval/guardrail
tests, provider-boundary request counts and omission checks; affected lint.
Record red/green evidence and actual commands/results.

**Progress:** Unassigned; branch/worktree, starting base, commits, actual results pending.

## 05 — Screen interview inputs once

**What to build:** Cover library entries, submitted answers, reused questions and exclusions
for question generation/replacement and feedback with one pass per input.

**Blocked by:** 01.

**Layers:** AI interview agents, handlers/context assembly, screening, tests.

**Modularity:** Use the shared source approval interface. Keep answer persistence owned by
Rails and category-specific generation/validation in existing interview modules.

**Status:** implemented.

**Acceptance Criteria:**
- All untrusted library/question/answer inputs reaching either agent are covered once.
- Required rejected answers prevent feedback while preserving saved-answer messages;
  optional library omissions keep warnings.
- Replacement exclusions remain correct, and direct calls remain guarded.
- Unchanged inputs are reused only in this execution; category and validation behavior hold.

**Verification:** `test_interview_questions_handler.py`, `test_interview_feedback_handler.py`,
relevant interview contract/guardrail tests, actual provider-count assertions; affected lint.
Record red/green evidence and actual commands/results.

**Progress:** Unassigned; branch/worktree, starting base, commits, actual results pending.

## 06 — Complete migration, verify all paths, and run live Jev evaluations

**What to build:** Remove the obsolete duplicate screening path after all consumers migrate,
document the new policy, and verify the final behavior offline and against live Jev.

**Blocked by:** 02, 03, 04, 05.

**Layers:** AI screening/evals/tests, affected repository guidance and architecture docs.

**Modularity:** Keep one screening owner. Audit all seven generative agents, user/tool
history, masking transformations, lifecycle and request usage integration. Do not leave
production fallback paths that silently trust unproven approvals.

**Status:** implemented.

**Acceptance Criteria:**
- All plan acceptance criteria pass across integrated flows; no duplicate final-prompt
  Jev pass or unprotected generative path remains.
- Existing screen and guardrail live suites run after implementation. Extend evaluation
  to compare 2,000- and 4,000-character chunks, each with 300-character overlap, against
  whole-resume screening on identical synthetic ordinary and long resumes. Include benign
  cases and attacks near the beginning, middle, end, and across chunk boundaries.
- Report missed attacks, false positives, per-document latency, request counts, and
  available usage/cost for each configuration. Whole-resume runs are an evaluation
  baseline, never a second production pass. Select the production size only after live
  results; document tradeoffs or raise unresolved uncertainty if no choice is supported.
- After selecting the size, rerun affected offline checks and final live Jev verification
  using the production configuration.
- Provider errors/unavailable checks cannot score as successful attack detection.
- Record decisions, case failures, comparison limitations, and actual provider usage where
  available. Do not infer effectiveness from offline tests or hide failing live cases.
- Update affected guidance and architecture documentation. No real user data in fixtures.

**Verification:** Full `docker compose run --rm ai pytest -m "not db"` and
`docker compose run --rm ai ruff check .`; schema dependency tests are included in the
offline suite. Then run `python -m evals.run_user_text_screen_evals` and
`python -m evals.run_prompt_guardrail_evals` inside the Compose ai container, plus the
production chunking comparison and affected generative eval runners required by guidance.
The human explicitly requested final live Jev tests; missing credentials/provider access
must be recorded as a blocker. No agent browser QA. Coordinator subsequently performs
acceptance audit, two blind reviews, supported fixes/rechecks, and PR handoff.

**Progress:** Unassigned; branch/worktree, starting base, commits, actual results pending.

## Dependency and delivery notes

01 enables 02–05. Those migrations can run concurrently in isolated worktrees if shared
screening and helper edits are coordinated; integrate them one at a time and verify each.
06 depends on all migrations. Intermediate commits retain safe guards for unmigrated
callers and must stay green. Integration/review/PR remain coordinator responsibilities.

Implementation uses isolated worktrees. Actual branch names use the workflow's
`work/upload-resume-double-calls-jev-<NN>-<ticket-slug>` convention.
The human approved the chunk comparison amendment and overall breakdown. Tickets 01–05
can verify both candidate sizes without choosing a production
default; ticket 06 owns the live comparison, default selection, and final rechecks.

## Actual integration checkpoint

Tickets 01–06 are implemented and integrated. The original
per-ticket progress entries above describe planned assignment; this checkpoint records
actual delivery pending the final acceptance audit.

| Ticket | Integrated commit | Verification |
| --- | --- | --- |
| 01 | 783a759 | Full offline 437 passed, 9 deselected |
| 02 | 036e6c8 | Integrated focused job suite 23 passed; worker full 446 passed |
| 03 | aa20394 | Integrated focused suite 21 passed; worker full 442 passed |
| 04 | 77a5fed | Worker full 442 passed; final integrated suite below |
| 05 | ee1df6b (+ helper 83b8fdd) | Integrated focused 70 passed; worker full 444 passed |
| 06 | 198eb34, 651bd51, 4c8879a | Full offline 481 passed; repeated live comparisons and both Jev suites passed |

All full suites excluded 9 database tests. All-migration integrated offline suite:
463 passed, 9 deselected. Final suite: 481 passed, 9 deselected. Actual red/green,
live outcomes, reviewed snapshots, and limitations are recorded in plan.md and the
verification report. Both blind reviews returned no actionable findings. PR handoff
is next; browser QA and human acceptance remain outstanding.
