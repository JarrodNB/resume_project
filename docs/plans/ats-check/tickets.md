# ATS check tickets

Implements the approved `plan.md`. Breakdown approved by the user on 2026-10-17. Planning commit: 286247344dda72b3a0608f6279c10b387c229d90. Integration branch created from that commit. Status describes
delivery progress; dependencies and the approval gate determine whether work can start.

The coordinator resolves WSL/Git access, verifies the checkout and unrelated changes,
commits approved planning artifacts on master, then creates `work/ats-check` from that
commit. Workers use isolated branches/worktrees based on the current integration head.
All checks run in Docker, with no browser automation. Each behavior change follows the
workflow's red-green-refactor instructions; record actual commands and failures.

## 01 — Saved resume content checks

- **What to build:** Saving a new or changed resume schedules a durable content check;
  users can query its report or request a rerun through GraphQL. Results assess job
  alignment and content quality with evidence, findings and the approved scoring rubric.
- **Blocked by:** None.
- **Layers:** Rails persistence/services/jobs/GraphQL; AI schemas, read-only retrieval,
  worker/agent/evals; generated GraphQL contracts; architecture documentation.
- **Modularity:** Rails ATS services own snapshots, run identity, scheduling, freshness,
  atomic result application and rubric calculation. Save services request checks through
  a small interface. Python owns structured assessment and validates evidence against
  immutable snapshots. Use existing task, allowance, subscription and accounting seams.
  Establish independent category state so PDF results can be added without changing the
  content-check lifecycle. Generate schema/types; never hand-edit generated files.
- **Status:** implemented.
- **Acceptance Criteria:**
  - First/changed saves schedule after commit; unchanged saves do not. A failed save
    schedules nothing. Dispatch or allowance failure cannot undo successful saving.
  - Persist recoverable scheduling state; retry transient dispatch failure without creating
    duplicate tasks. No endless automatic retries from unchanged saves.
  - Owned GraphQL report reads and manual reruns expose task state, structured findings,
    category scores, rubric deductions/version and input identity. Cross-user access fails.
  - Required/preferred requirement weighting and applicable content checks follow the plan;
    evidence references resolve to actual snapshot text. Suggestions invent no career facts.
  - Job deletion/no usable requirements explicitly makes alignment unavailable; job edits
    invalidate alignment. Saved content changes invalidate prior scores. Overall stays
    pending awaiting PDF, and failed applicable checks cannot count as completed.
  - Concurrent starts reuse matching in-flight work; explicit reruns can replace finished
    runs. Duplicate/late/malformed results cannot overwrite a newer current report or
    double-count usage. Immutable runs preserve their exact inputs.
  - Follow existing masking, screening, limits, tracing and transcript rules. Extend only
    required read-only grants with user-scoped queries; workers never write domain data.
  - Synthetic evals cover requirement coverage, evidence, supported suggestions and score
    consistency. Document new queue contracts, scoring and freshness behavior.
- **Verification:** Intended: focused Rails save/update, ATS service/job, GraphQL, result
  handling and grant specs; offline AI handler/schema/scoring tests; schema dependency
  test; Ruff; GraphQL schema dump and frontend codegen; paid ATS content eval runner.
  Run with `docker compose run --rm api bundle exec rspec <actual spec paths>` and
  `docker compose run --rm ai pytest -m 'not db' <actual test paths>`; grant/database tests
  need the Compose DB. Use commands in `docs/testing.md` for remaining checks.
  Actual commands/results and red/green evidence: not run.
- **Progress:** Intended branch `work/ats-check-01-content-checks`; worktree, starting
  base and resulting commits unassigned. Blockers: breakdown approval, planning commit,
  WSL/Git execution access. Concerns: exact snapshot schema and result validation must
  preserve version identity and fit existing task limits.

## 02 — Content report and rerun interface

- **What to build:** Saved resume pages display content assessments, category scores,
  transparent deductions and prioritized suggested actions, with rerun/retry controls and
  accurate pending/outdated states.
- **Blocked by:** 01.
- **Layers:** Web saved resume editor, report components/hooks, GraphQL operations/types.
- **Modularity:** A cohesive ATS feature owns report presentation and task subscriptions.
  Reuse established error and collapsible section patterns. Editor provides dirty state;
  it does not calculate server scores or coordinate report internals.
- **Status:** implemented.
- **Acceptance Criteria:**
  - Show queued/running/completed/failed/unavailable categories and awaiting-export PDF
    state. Show findings with severity, location, evidence, explanation and suggested action.
  - Explain Careergrind scoring and deductions without representing employer scores.
    Overall remains pending until applicable PDF checks complete.
  - Unsaved edits immediately label earlier feedback outdated. Saving changed content
    follows the new run. Subscription updates cannot make another version look current.
  - Manual rerun targets saved input; unsaved edits require an explicit normal save.
    Rerun/retry errors are separate from save errors; repeated clicks avoid duplicate work.
  - The report starts collapsed according to repository conventions. Suggestions never
    mutate resume content. No editing/saving action generates or uploads an ATS PDF.
- **Verification:** Intended: focused saved-editor/report component tests through rendered
  controls and mocked GraphQL boundaries; existing tailoring/resumes regression tests;
  frontend typecheck/lint. Use `docker compose run --rm --no-deps web npm test -- <paths>`,
  `npm run typecheck` and `npm run lint` in the same container form.
  Actual commands/results and red/green evidence: not run.
- **Progress:** Intended branch `work/ats-check-02-content-report`; worktree/base/commits
  unassigned. No implementation started. Concern: retain current editor drafts while
  subscription updates refresh report data.

## 03 — Exact exported PDF inspection

- **What to build:** An owned, version-bound PDF submission can be inspected asynchronously
  and produces evidence-backed readability results on the matching report.
- **Blocked by:** 01.
- **Layers:** Rails upload/start/result/cleanup services and jobs, GraphQL; Python document
  inspection, worker/schema and tests; generated contracts and architecture docs.
- **Modularity:** Add PDF lifecycle through the established ATS aggregate and a small
  inspection interface. Local deterministic extraction/comparison owns normalization and
  tolerances; shared schemas do not depend on orchestration. Reuse Active Storage and
  task publication rather than introducing a second upload/queue system.
- **Status:** implemented.
- **Acceptance Criteria:**
  - Submission validates ownership, saved version and attachment association server-side,
    plus byte-detected PDF type and size. Stale submissions return a refresh error.
  - Queue only blob key/metadata and immutable run references. Record digest, renderer and
    rubric versions. Matching in-flight submissions deduplicate; repeats remain safe.
  - Inspect actual bytes locally against expected export content for text extraction,
    coverage, reading order, characters/words and section/entry boundaries. Return page/
    excerpt evidence and deterministic scores with documented tolerances.
  - Corrupt/uninspectable files fail visibly, without becoming a zero, a pass, or current
    completed scores. A failed PDF check preserves successful content results.
  - Guard result identity and freshness against edits, concurrent exports and late delivery.
    Combine only applicable current results for the rounded equal-weight overall score.
  - Purge processing files after success and terminal failure, including abandoned start
    failures; metadata/evidence remain. Retry after cleanup requires another export.
  - Synthetic real-PDF fixtures cover good extraction, missing/reordered text, character
    loss, corruption and multi-page content. No PDF is sent to a model.
- **Verification:** Intended: focused upload/ATS/result/cleanup/authorization Rails specs;
  offline deterministic PDF and worker pytest; schema dependency test; Ruff; schema dump
  and codegen; frontend typecheck after generated changes. Run actual commands using
  `docs/testing.md`; include duplicate, stale and malformed result paths.
  Actual commands/results and red/green evidence: not run.
- **Progress:** Intended branch `work/ats-check-03-pdf-inspection`; worktree/base/commits
  unassigned. No implementation started. Concern: PDF fixture comparisons must expose
  content loss while tolerating ordinary renderer wrapping and whitespace.

## 04 — Export PDF and complete the report

- **What to build:** Export downloads the PDF and submits the same bytes for checking;
  users see PDF findings and the completed overall score when applicable checks finish.
- **Blocked by:** 02, 03.
- **Layers:** Web export/document/report integration; non-browser PDF integration fixtures;
  necessary cross-layer fixes and behavior documentation.
- **Modularity:** Reuse `ResumePdfDocument` and `buildResumePdfModel`. Export owns generating
  one blob and coordinating download/submission through the ATS API. Report components
  consume category state, not extraction internals. Keep preview independent of checks.
- **Status:** implemented.
- **Acceptance Criteria:**
  - Add Export PDF for the saved resume. Unsaved edits require explicit saving first.
  - Generate once and use the same blob for download and upload. Download does not wait
    for analysis and survives upload/check failure with a separate actionable error.
  - Editing/saving creates no ATS PDF work; preview queues no ATS work. Re-export provides
    PDF retry and current run identity without mismatching other tabs or saved versions.
  - Display PDF progress, findings, deductions and retry guidance. Overall appears only
    when all applicable current categories finish; failed/pending checks never inflate it.
  - Non-browser integration tests generate actual production-component PDFs and pass
    them through the production extractor/comparator, including long multi-page content,
    contact/link text and ordinary wrapping. Record any fixture generation requirements.
  - Update affected navigation/instructions/docs and prepare the manual QA steps from
    the plan. Do not remove the board item or claim human acceptance.
- **Verification:** Intended: focused export/report/saved-editor tests; actual generated PDF
  integration check; existing resume PDF model tests; frontend typecheck/lint; relevant
  Rails/AI integration regression suites. Coordinator verifies every plan acceptance
  criterion, runs the paid content eval if not already recorded for the final prompt, and
  records all limitations. Actual commands/results and red/green evidence: not run.
- **Progress:** Intended branch `work/ats-check-04-export-report`; worktree/base/commits
  unassigned. No implementation started. Concern: renderer/version identity and error
  handling must preserve a successful download independently of the check request.

## Coordinator integration and handoff

Integrate and verify 01 before releasing 02 and 03. They may run concurrently in isolated
worktrees, but both touch generated GraphQL contracts: integrate sequentially and regenerate
contracts on the integration branch rather than retaining conflicting generated edits.
Release 04 only after both integrate and pass relevant checks.

After all tickets, check every acceptance criterion, commit the candidate and freeze base/
head IDs. Run fresh blind correctness and design reviewers concurrently as specified by
the workflow. Resolve supported findings with TDD and repeat fresh reviews after substantial
fixes. Then create/attach the PR with actual checks, limitations and manual QA. Stop for
human review; do not merge, deploy or clear the Kanban item.

### Coordinator status after ticket 01

01 implemented and verified on integration as 836c612 (worker c19e79f).
02 in-progress on work/ats-check-02-content-report at /home/jarrod/ats-check-02.
03 in-progress on work/ats-check-03-pdf-inspection at /home/jarrod/ats-check-03.
Both start at 836c612. 04 awaits both. Verification details are in the plan delivery record.

### Final implementation state

All four tickets implemented and verified on candidate 7e3bb7e. Ticket 02 integrated
93787fb; 03 integrated b98fce1; 04 integrated de6c5cf plus production PDF and identity/
ordering regressions. Actual verification and acceptance audit are in plan.md.
Blind review results, PR and human manual QA remain pending.

### Human handoff

All tickets implemented and verified; both final blind reviews clean.
PR: https://github.com/JarrodNB/resume_project/pull/15 (work/ats-check).
Manual QA and explicit human completion acceptance remain pending. Board item retained.
