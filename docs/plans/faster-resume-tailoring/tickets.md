# Faster resume tailoring — tickets

Breakdown revision 1. Based on approved plan revision 1. Human breakdown approval pending.
No implementation, integration branch, or worker worktree is authorized by plan approval alone.

All writers use separate worktrees based on the current verified integration head. The
coordinator owns this file, integration, board updates, and the PR. Workers report actual
red/green results, changed files, commits, and concerns; they never update those records.
Use TDD for behavior changes, Docker checks, synthetic fixtures, and no browser automation.

## Dependencies and scheduling

| Ticket | Delivered behavior | Blocked by |
| --- | --- | --- |
| 01 | Supported technology wording passes validation | None |
| 02 | Whole-draft evidence prepared and screened once | None |
| 03 | One queued task generates the complete draft | 02 |
| 04 | Complete-draft review supports section exclusion | None |
| 05 | New flow replaces obsolete approval contracts | 03, 04 |
| 06 | Integrated behavior, evals, and documentation verified | 01, 03, 05 |

01, 02, and 04 can start concurrently after approval. Dependency readiness does not justify
concurrent writes to the same files: serialize or rebase work where ownership overlaps.
Integrate sequentially, verify, and only then release dependent tickets. Each implementation
commit must keep its relevant checks green. New preparation is introduced alongside the old
handler, then adopted in 03; the old cross-service approval interface is removed in 05.

## 01 — Accept supported technology names without false retries

**What to build:** Fix the faithfulness check so supported sentence-opening wording such as
“Implemented Qdrant” and “Built GraphQL APIs” passes without losing legitimate protection
against invented claims.

**Blocked by:** None.

**Layers:** AI validation and its regression tests.

**Modularity:** Keep claim interpretation in the existing tailoring validator. Exercise
`find_section_problems` with synthetic labeled sources and agent output validation where
needed; do not create a second name validator or rewrite valid model prose in code.

**Status:** ready-for-agent. Human breakdown approval is still required.

**Acceptance Criteria:**

- The two observed wording patterns pass when their cited sources support them.
- Unknown source labels, unsupported technologies, multiword names, and invented numbers
  remain rejected, including genuine unsupported claims at sentence start.
- A supported draft retains its wording; failure reasons remain useful for model retries.

**Verification:** Red: run a focused synthetic regression and observe the false rejection.
Green: fix matching and rerun it. Broaden with
`docker compose run --rm ai pytest -m "not db" tests/test_check_section_faithfulness.py tests/test_tailoring_evaluators.py`
and `docker compose run --rm ai ruff check .`. Actual checks/red-green evidence: not run.
Ticket 06 runs live agent quality evaluations after integration.

**Progress:** Planned branch `work/faster-resume-tailoring-01-faithfulness`.
Worktree/base/commits: not assigned. Concern: narrow the false-positive fix without allowing
unsupported proper names. Covers plan acceptance criterion 7.

## 02 — Prepare shared evidence once with bounded screening

**What to build:** Add a whole-draft preparation interface that produces usable, screened
inputs for every relevant section from one user-scoped context. Shared evidence is checked
once per execution, with bounded concurrent screening and exact prompt coverage.

**Blocked by:** None.

**Layers:** AI tailoring preparation, screening integration, retrieval integration, tests.

**Modularity:** Preparation owns selection, source labels, screen decisions, omission
warnings, and prompt binding. Keep SQL in database modules and user filtering intact.
Use existing screening policy and provider interfaces. Introduce preparation alongside the
old handler so this slice can be tested without switching queue/UI contracts.

**Status:** ready-for-agent. Human breakdown approval is still required.

**Acceptance Criteria:**

- The job is screened before query embedding. Rejected required job context prevents
  retrieval/generation; blocked optional evidence is excluded with warnings.
- Retrieval retains section relevance and fallback without embeddings. An entry selected
  for multiple sections is screened once and remains available to each relevant writer.
- Concurrency is bounded and demonstrably overlaps independent calls using controlled
  barriers. Duplicate in-flight source checks do not bill twice because of a cache race.
- Exact approved strings cover bound prompts; unknown direct prompts still invoke the
  guardrail. No concatenated screen silently approves unscreened constituent strings.
- Privacy, usage, and transcript contexts remain active. Cancellation is awaited; a fresh
  execution repeats screening and cannot inherit approvals from the previous attempt.
- Shared screening helpers keep other tasks' established behavior.

**Verification:** Red/green at the preparation interface and classifier boundary. Run
`docker compose run --rm ai pytest -m "not db" tests/test_tailoring_screening.py tests/test_screening_session.py tests/test_task_usage_guardrails.py tests/test_task_usage_accounting.py`
plus the new preparation tests, `docker compose run --rm ai pytest tests/test_schema_dependencies.py`,
and `docker compose run --rm ai ruff check .`. Broaden to other screening tests if shared
helpers change. Actual commands/red-green results: not run.

**Progress:** Planned branch `work/faster-resume-tailoring-02-preparation`.
Worktree/base/commits: not assigned. Concern: actual screen policy cannot be mocked away in
coverage tests. Covers preparation portions of plan criteria 3, 4, 5, 6, and 9.

## 03 — Generate a complete resume in one queued execution

**What to build:** Replace the Python handler's approval loop with complete-draft generation.
Copy predictable sections, generate independent sections concurrently, then write the summary
and publish one ordered result. Keep failure, retry, accounting, and queue behavior correct.

**Blocked by:** 02, integrated and verified. Ticket 01 is independent and does not block
generation implementation; it must be integrated before final verification.

**Layers:** AI tailoring, agent/prompt interfaces, task handler, worker lifecycle tests.

**Modularity:** Expose complete-draft behavior through one tailoring interface; keep queue
plumbing in the handler. Use async provider interfaces without nesting `asyncio.run` inside
an event loop. Share the prepared evidence from 02; callers do not sequence sections.
Retain schema dependency directions and existing result shapes.

**Status:** blocked.

**Acceptance Criteria:**

- One task returns completed ordered sections and warnings with no needs-user-input pause.
- Contact, education, and certifications are copied with no generative calls; descriptions,
  identity, credential expiry meaning, and date precision are preserved.
- Experience, projects, and skills run with bounded overlap when inputs exist. Summary
  follows selected content and uses screened inputs with supported citations.
- Empty library sections skip writers. Nothing-fits optional sections are omitted with
  section-specific explanations, without inventing material or pausing for write-anyway.
- Missing jobs and required operation failures never yield completed partial output.
  The shared execution deadline cancels and awaits outstanding work within queue limits.
- Transient failures retain the existing retry policy. Real provider work, including failed
  and cancelled requests with unknown usage, remains accounted for in the attempt record.
- Duplicate/retried executions do not write domain data; privacy and transcript attribution
  remain task-scoped through success and failure.

**Verification:** Red/green through `handle_tailor_resume_task`, agent model interfaces, and
`process_task_message`; use controlled concurrency and failures rather than timing guesses.
Run `docker compose run --rm ai pytest -m "not db" tests/test_tailor_resume_handler.py tests/test_tailoring_screening.py tests/test_task_usage_accounting.py tests/test_task_usage_providers.py tests/test_run_limits.py`
plus new draft/lifecycle tests, schema dependency tests, and AI lint. Keep the full offline
AI suite green after replacing obsolete Python approval-loop tests. Actual results: not run.

**Progress:** Planned branch `work/faster-resume-tailoring-03-complete-draft`.
Worktree/base/commits: not assigned. Concern: existing synchronous agent entry points and
execution-local contexts must compose correctly under concurrency. Covers plan criteria 1–6
and the worker portions of 9. Python-only obsolete state can be removed here; Rails/UI
contract removal belongs to 05.

## 04 — Review and exclude sections before saving the complete draft

**What to build:** Extend the existing complete-draft editor so users can review, edit,
exclude sections, preview, and save the resulting resume. Keep edits stable while sections
are collapsed or excluded; provide a way to include an excluded section again before save.

**Blocked by:** None. The existing completed result shape already supports this editor.

**Layers:** Web complete-draft editor, draft conversion, preview wiring, UI tests.

**Modularity:** Keep draft and inclusion state together in the editor; save and preview
consume the same selected content. Reuse existing field editors and PDF model. Do not change
generated GraphQL files or remove the old task progress UI in this ticket.

**Status:** ready-for-agent. Human breakdown approval is still required.

**Acceptance Criteria:**

- Every completed section can be edited or excluded before saving; inclusion changes do
  not shift another section's edits or lose draft values.
- Preview and save include the same selected sections with current edits and stable order.
- Existing collapsed-section behavior, omission warnings, save errors, and saved-resume
  editing remain supported. An invalid empty selection cannot silently save the old draft.
- Editing or excluding a draft section does not issue a generation request or change the
  career library.

**Verification:** Red/green through rendered editor/page interactions and mutation payloads.
Run `docker compose run --rm --no-deps web npm test -- src/features/resume-tailoring`,
frontend typecheck and lint. PDF rendering is mocked in jsdom; human verifies visuals.
Actual commands/red-green results: not run.

**Progress:** Planned branch `work/faster-resume-tailoring-04-draft-editor`.
Worktree/base/commits: not assigned. Covers the editor/preview portion of plan criterion 8.

## 05 — Replace approval contracts with complete-draft start and save

**What to build:** Wire the complete-draft flow through Rails and the web page, remove
obsolete tailoring approval actions, and preserve secure, once-only saving and result
handling. New runs show a whole-draft loading state, then the editor or failure/retry.

**Blocked by:** 03 and 04, integrated and verified.

**Layers:** Rails services/GraphQL/results, web task page/hooks, generated schema/types, tests.

**Modularity:** Rails services own enqueue/save rules; GraphQL remains thin and user-scoped.
The page follows task status rather than Python section sequencing. Remove only tailoring's
obsolete submit/reopen state and interfaces; preserve shared needs-user-input capabilities
and usage handling for other tasks. Keep generated outputs owned by their generators.

**Status:** blocked.

**Acceptance Criteria:**

- Start snapshots the needed task input without obsolete approval state. A new task uses
  the complete-draft handler and is followed through subscriptions and reload.
- The page displays whole-draft loading, completed review, warnings, and failure/retry;
  no section-approval, write-anyway, or reopening controls remain.
- Final save persists only the edited/included sections in stable order, once; explicit
  empty selection is rejected instead of falling back to the original task result.
- Completed/saved results remain editable; library data is unchanged. No migration, reset,
  or compatibility branch is added for unfinished old tasks.
- Tenant isolation, duplicate result handling, repeat-save protection, and late usage
  deduplication remain correct. Other task types keep their behavior.
- No consumers reference the removed mutation. Rails schema and frontend generated types
  are regenerated together and committed with the interface changes.

**Verification:** Red/green through Rails service/GraphQL interfaces and page interactions.
Run `docker compose run --rm api bundle exec rspec spec/services/resume_tailoring spec/services/ai_tasks/apply_ai_result_service_spec.rb spec/services/ai_tasks/record_attempt_usage_spec.rb spec/graphql/mutations/resume_tailoring_spec.rb`.
Run `docker compose run --rm api bin/rails graphql:schema:dump`, then
`docker compose run --rm --no-deps web npm run codegen`; run schema-dump specs, frontend
tailoring tests, typecheck, and lint. Actual red/green and generator outcomes: not run.

**Progress:** Planned branch `work/faster-resume-tailoring-05-flow-contracts`.
Worktree/base/commits: not assigned. Concern: empty array fallback in the existing save service
must not override section exclusion. Covers plan criteria 1, 6, 8, 9, and contract portions of 10.

## 06 — Verify the complete flow and update quality checks and guidance

**What to build:** Verify the integrated acceptance behaviors, adapt the tailoring eval path
to written versus copied sections, and update architecture/scoped guidance for the new flow.
Report actual latency/request evidence and quality outcomes without promising a fixed SLA.

**Blocked by:** 01, 03, and 05, integrated and verified (02 and 04 are transitive prerequisites).

**Layers:** Cross-layer acceptance checks, AI evals, architecture/scoped documentation.

**Modularity:** Exercise the production orchestration interface with synthetic fixtures;
do not create a second orchestration path solely for evals. Keep objective copied-field/date
checks separate from subjective written-section quality scores. Update existing guidance
where ownership and behavior changed rather than adding redundant file inventories.

**Status:** blocked.

**Acceptance Criteria:**

- Each plan acceptance criterion has direct evidence from integrated checks or an explicit
  pending human manual check. Any uncovered behavior gets meaningful regression coverage.
- The relevant offline AI suite, Rails behavior/schema checks, frontend tests/types/lint,
  and schema dependency checks pass, or a concrete blocker is recorded without claiming pass.
- Tailoring live evals cover the actual written sections; copied sections have deterministic
  identity/date checks. Run relevant screening/retrieval evals when changed by implementation.
- Synthetic whole-draft exercise records elapsed time, actual provider requests, and retries
  alongside quality outcomes. Do not compare unrelated datasets as a proven speedup or commit
  private career history/transcripts. No automatic report saving beyond requested artifacts.
- Architecture and affected AGENTS guidance describe complete-draft generation, screening
  ownership, failure behavior, and the removal of tailoring approval steps accurately.
- A human QA outline covers populated/sparse libraries, omissions, exclusion/preview/save,
  reload, saved editing, and failure/retry.

**Verification:** Run plan revision 1's relevant commands against the integrated checkout.
Run `docker compose run --rm ai python -m evals.run_tailoring_evals`; use synthetic fixtures
for a whole-draft production-path exercise. Live provider work incurs costs; record real
results/limits. Documentation uses diff/link checks rather than artificial red tests.
Actual checks/red-green evidence: not run.

**Progress:** Planned branch `work/faster-resume-tailoring-06-verification`.
Worktree/base/commits: not assigned. Covers final plan criterion 10 and checks coverage of 1–9.
Blind reviews, supported review fixes, PR creation, and handoff remain coordinator duties
after this ticket; they are not implied complete by its implementation status.
