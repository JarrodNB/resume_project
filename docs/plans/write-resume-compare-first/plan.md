# Write resume: Compare first

## Problem Statement

The job page recommends comparing a job before writing a resume, but its **Compare first**
button only closes the confirmation dialog. The user must find and start the comparison
separately. Writing can also begin while a comparison is still running.

## Human Decisions

Confirmed in chat on 2026-10-18:

- Compare first starts the comparison, closes the dialog, and stays on the job page with
  progress and results. Completion does not start writing automatically.
- Comparison is optional. Without an active comparison, Write resume anyway still goes
  straight to writing, even if there has never been a successful comparison.
- Write resume is disabled while a comparison is starting or active, regardless of whether
  the comparison started from the dialog or the How you match card, including after reload.
- Completion or failure enables writing again. Start failures show an error and allow retry.
- Open resume remains available for an already saved resume.

## User Stories

- As a user choosing Compare first, I want the comparison to start immediately and see its
  progress on the job page.
- As a user, I can choose to write without comparing, but cannot start writing from this
  page while a comparison is in progress.

## Solution

Connect both comparison controls to one owner for the job's comparison lifecycle. The job
page uses that state for its resume action and its How you match card. The dialog requests
the same comparison action as the card; it does not implement its own mutation or task
tracking. Keep existing result, evidence, error, and retry presentation.

## Implementation Decisions

- Keep comparison mutation, request errors, task selection, and subscription state in the
  gap-analysis feature behind a small hook interface. The page connects this interface to
  its two controls; presentational components receive state and callbacks.
- Reuse analyzeJobGaps, the existing job cache update, and aiTaskUpdated. Follow a queued
  task loaded with the job and tasks started during this visit. Treat the start request as
  busy immediately and retain busy state until a terminal task status is known.
- Queued means active in the current worker contract. Treat any nonterminal task status
  conservatively as active; COMPLETED and FAILED are terminal. A subscription error must
  not falsely mark an unfinished task complete or unlock writing.
- Keep completion state consistent between the card and the resume action. A completed
  comparison permits direct writing; a failed comparison permits the existing optional
  comparison dialog and Write resume anyway.
- Prevent repeated starts through either control while a request or task is active. If the
  dialog was already open when another control starts a comparison, its actions must not
  bypass that busy state.
- Keep saved-resume navigation independent of comparison state. Update affected feature
  guidance and handwritten file headers alongside the implementation.

## Testing Decisions

Use Vitest and Testing Library through renderPage with Apollo mutation and subscription
mocks. The primary seam is JobDetailPage: assert clicks, emitted mutation count, route,
disabled controls, visible progress/errors, and terminal results. Extend existing
JobDetailPage.test.tsx and GapAnalysisCard.test.tsx tests as needed for the shared owner.
Do not mock away comparison lifecycle behavior or assert internal hook sequencing.

Cover dialog start; a delayed start request; active tasks loaded on entry; comparison
started from the card; repeated clicks; completion; task failure; start validation/network
failure and retry; optional writing without comparison; and saved resume navigation.
Use controlled subscription updates to check queued-to-terminal transitions on the same
mounted page. Preserve existing comparison result and gap-response coverage.

## Architecture Decisions

This is a frontend interaction and state ownership correction. Rails remains the source of
truth, and existing queued work and live subscriptions remain unchanged. No new GraphQL,
queue, database, model, prompt, or glossary contracts are planned. No ADR is needed.

## Rollout Risks and Other Risks

- Separate task owners can leave the header stale after live completion. One lifecycle
  owner must supply both views.
- The interval between clicking and receiving a task ID can allow a second action unless
  the start request itself counts as busy.
- Reload or a subscription failure must not incorrectly unlock writing for a queued task.
- Moving lifecycle ownership must preserve existing card results, responses, and retry.

## Observable Acceptance Criteria

1. Compare first sends one comparison request for the current job, closes the dialog, and
   stays on the job page displaying comparison progress and then its outcome.
2. Write resume is disabled during the start request and active comparison, from either
   comparison entry point and when loading an already active task. No dialog action can
   start writing during that interval.
3. Live completion enables direct Write resume navigation without automatic navigation.
4. A failed task or failed start displays the existing useful error and retry path and
   enables optional writing again. A subscription error alone does not unlock an active task.
5. With no active comparison, Write resume anyway navigates to tailoring without starting
   a comparison. A completed comparison still permits direct writing.
6. An existing saved resume still opens while comparison is active.
7. Existing comparison results, evidence, gap responses, and rerun behavior remain covered.

## Dependencies and Verification

No external dependency or paid evaluation is needed. Run all application checks in Docker
from the implementation worktree, following docs/testing.md:

```bash
docker compose run --rm --no-deps web npm test -- src/features/jobs/JobDetailPage.test.tsx src/features/gap-analysis/GapAnalysisCard.test.tsx
docker compose run --rm --no-deps web npm test
docker compose run --rm --no-deps web npm run typecheck
docker compose run --rm --no-deps web npm run lint
git diff --check
```

Add any new focused test files to the focused command. Record actual red/green results and
execution limitations in the tickets and delivery record. Two fresh blind reviews follow
integration and checks.

Human QA: choose an uncompared job, click Write resume then Compare first, observe progress
and the disabled resume action, and wait for completion before writing. Also start from the
card and reload during comparison; check failure/retry when available, optional writing on
an uncompared job, and opening an existing resume. No agent browser automation.

## Out of Scope

Comparison quality/speed, requirement selection, tailoring content/styling, automatic
writing after comparison, and server-side or direct-route restrictions on tailoring.

## Additional Notes

Source item is already marked IP on KANBAN.md. Leave it on the board until the human
explicitly accepts completion. No existing plan or tickets for this item were found.

## Delivery Record

- Source: write resume -> compare first should do the comparison when clicked.
- Phase: reviewed branch ready; human explicitly authorized GitHub publication and worktree cleanup.
- Requirements: confirmed in chat, including optional comparison and active-task blocking.
- Plan approval: human replied "confirmed" to revision 1 in chat on 2026-10-18.
  Approved plan SHA-256 before this delivery-record update:
  `3a5ad6fad2b896051bbc55be1aa54c9b90361f89d87b5df2cc6fd21d4d80fb70`.
- Breakdown approval: human replied "approved" in chat on 2026-10-18 to tickets revision 1,
  SHA-256 `4e77a9b08e2752ad4b9dc26918b330130f2dc73d41140d6143f7414213301f29`.
- Original planning commit: `9a8616f`, committed on master. For a focused PR, the isolated
  integration branch was rebased onto remote master `6930b8e`, excluding an unrelated local
  planning commit. Equivalent planning commit: `5b3a717`.
- Integration branch: work/write-resume-compare-first, worktree .worktrees/compare-first-integration.
- Ticket 01: implemented; worker branch work/write-resume-compare-first-01-comparison-flow,
  worktree .worktrees/compare-first-01, starting base `9a8616f`, worker commit `16b68c1`,
  integrated as `c34d4ac`.
- Verification: coordinator Docker focused run passed 26 tests; typecheck and lint passed
  (0 warnings/errors). Worker final Docker full suite with --maxWorkers=1 passed 154 tests
  in 35 files. git diff --check passed. Initial default concurrent suite had six failures
  (timing contention and one test needing an Apollo-broadcast wait); final serial run passed
  after fixing that synchronization. No application timeout changes.
- Coordinator acceptance check: criteria 1–6 covered by page controls, real Apollo mutation
  and live subscription tests; criterion 7 covered by preserved card/result/response tests.
  No schema or worker changes. No browser QA performed.
- Review snapshot: base `6930b8e9273648494e564ee920b2fb8a6770ff3e`,
  head `c34d4ace089cc5bad2282590d49f30a892dd370a`. Both reviewers independently passed
  26 focused Docker tests. Design: no actionable findings. Correctness: P2, local started
  task ID permanently overrides a newer task returned by a job refetch, permitting writing
  while that newer comparison is active. Supported by code inspection; worker assigned a
  real-Apollo regression and correction. A fresh review pair is required after the fix.
- P2 resolution: regression reproduced enabled direct-writing link after locally completed
  A was superseded by queued B in refreshed job cache. Worker fix `875349f`, integrated
  `a33ac6f`, limits the local task override to the interval before the job acknowledges a
  new task identity. New test also verifies B's live completion unlocks writing. Focused
  Docker tests: 27 passed; worker typecheck/lint/diff checks passed. Post-fix full serial
  suite: 154/155 passed in 35 files; sole failure was unchanged InterviewSetPage queued/live
  test. Isolated rerun of that file passed all 3 tests (exit 0). No unrelated source changes.
- Round 2 snapshot: original base `6930b8e9273648494e564ee920b2fb8a6770ff3e`,
  head `a33ac6fd7b76873696157a040d3f1c4ef6a22fdb`; both fresh reviewers report no
  actionable findings and independently passed 27 focused Docker tests and diff checks.
  Coordinator final integrated typecheck/lint passed (0 warnings/errors). Only delivery
  records changed after this review snapshot; no additional source review is needed for
  these editorial progress updates.
- PR blocked: automatic approval review rejected git push to origin
  https://github.com/JarrodNB/resume_project.git, stating that external destination/payload
  were not explicitly authorized. No push or PR creation occurred. Human approval needed
  to publish work/write-resume-compare-first and create its PR targeting master there.
- Publishing authorization: human said "Push the PR and free up the worktree" in chat.
  Git HTTPS push then failed because no credentials were configured. The authenticated
  GitHub connector is available; publishing the same reviewed file snapshot through it,
  with a tree-equality check before removing clean task worktrees. Local review commits
  remain in git history; source files have not changed since review round 2.
- Manual QA and human acceptance pending. Board item retained. Root checkout remains on
  master with the planning commit; implementation is in .worktrees/compare-first-integration.

### Prepared PR description

Title: Start comparison from the resume prompt and pause writing while it runs

Compare first previously only dismissed the resume prompt. It now starts the job comparison
and shows progress/results on the job page. Writing without comparison remains available;
Write resume is disabled only while comparison is starting or active. Both entry points,
reloads, newer tasks, live completion/failure, and saved-resume navigation share task state.

Validation: 27 focused frontend tests, typecheck, and lint pass. Two final blind reviews
have no actionable findings. Initial full serial suite passed 154 tests; after the review
fix the expanded suite passed 154/155, with an unchanged interview subscription test passing
on isolated rerun (3/3 in that file). No browser QA performed.

Human QA: try Compare first, compare from the card, reload during comparison, retry after
failure where available, write without comparing, and open an already saved resume.
