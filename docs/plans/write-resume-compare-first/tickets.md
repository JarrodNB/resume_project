# Write resume: Compare first — tickets

Breakdown revision 1. Based on approved plan revision 1. Human approved this breakdown in
chat on 2026-10-18; implementation is being prepared.

## Ticket 01 — Start comparison from the dialog and coordinate writing availability

**What to build:** Clicking Compare first starts the comparison on the current job page.
Both comparison entry points share lifecycle state, and Write resume is unavailable only
while a comparison is starting or active. Comparison remains optional.

**Blocked by:** None.

**Layers:** Web frontend, frontend regression tests, affected feature guidance.

**Modularity:** The gap-analysis feature owns the mutation, errors, selected task, and live
subscription behind one hook interface. The job page connects that state to the comparison
card and resume action. The dialog requests an action through a callback. Preserve existing
GraphQL/queue contracts. Test through the job page's real controls and Apollo mocks, keeping
the existing comparison card and gap-response coverage meaningful.

**Status:** implemented.

**Acceptance Criteria:**

1. Compare first closes the dialog, sends one comparison request, stays on the job page,
   and displays progress and the eventual result without automatically starting writing.
2. Write resume is disabled immediately during the start request and while a task remains
   active. This applies to both comparison entry points and active tasks loaded on entry
   or reload. Repeated clicks do not enqueue duplicate work. An already open dialog cannot
   bypass the writing restriction.
3. Live completion enables direct writing. Task failure or start validation/network failure
   shows a useful error and retry path and permits optional writing again. A subscription
   error alone does not unlock writing for an unfinished task.
4. With no active comparison, Write resume anyway goes to tailoring without starting a
   comparison. A completed comparison still permits direct writing. Open resume remains
   available for an existing saved resume even during an active comparison.
5. Existing result, evidence, gap-response, and comparison rerun behavior stays intact.
   Affected feature instructions and file headers describe the resulting behavior.

**Verification:**

Use small red-green-refactor cycles through observable behavior. First change the regression
test that currently expects Compare first only to close the dialog and demonstrate the
missing request/progress behavior. Add focused coverage for request-in-flight blocking,
both entry points, queued-to-terminal updates on the same mounted page, reload state,
failure/retry, and optional writing. Keep each red failure attributable to missing behavior,
not test setup. Use controlled Apollo mutation/subscription boundaries rather than mocking
the lifecycle owner. Run in Docker from the assigned worktree:

```bash
docker compose run --rm --no-deps web npm test -- src/features/jobs/JobDetailPage.test.tsx src/features/gap-analysis/GapAnalysisCard.test.tsx
docker compose run --rm --no-deps web npm test
docker compose run --rm --no-deps web npm run typecheck
docker compose run --rm --no-deps web npm run lint
git diff --check
```

Include any new focused test files in the first command. No browser automation or paid evals.
Actual checks used the compatible local Docker image without network, mounting the worker
or integration checkout's apps/web at /app with an anonymous /app/node_modules volume:

```bash
docker run --rm --network none -v "$PWD/apps/web:/app" -v /app/node_modules -w /app resume_project-web:latest npm test -- src/features/jobs/JobDetailPage.test.tsx src/features/gap-analysis/GapAnalysisCard.test.tsx --maxWorkers=1
docker run --rm --network none -v "$PWD/apps/web:/app" -v /app/node_modules -w /app resume_project-web:latest npm test -- --maxWorkers=1
docker run --rm --network none -v "$PWD/apps/web:/app" -v /app/node_modules -w /app resume_project-web:latest npm run typecheck
docker run --rm --network none -v "$PWD/apps/web:/app" -v /app/node_modules -w /app resume_project-web:latest npm run lint
```

- Red: changed dialog regression failed because Write resume remained enabled after
  Compare first; eight other page tests passed.
- Green: initial focused page/card run passed 18 tests; expanded final focused run passed
  26 tests, independently rerun on the integrated candidate by the coordinator.
- Broader: final serial full suite passed 154 tests across 35 files (exit 0, 163 seconds).
  Initial default concurrent run failed six tests under resource load, including a new
  assertion before Apollo broadcast; added waitFor for that actual UI update. Final run
  passed all previously failing files. No test timeout settings changed.
- Typecheck, lint (0 errors/warnings), and git diff --check passed.

**Progress:**

- Planned worker branch: work/write-resume-compare-first-01-comparison-flow.
- Worktree: .worktrees/compare-first-01; starting base `9a8616f`; worker commit `16b68c1`.
  Integrated as `c34d4ac` after rebasing integration planning onto remote master to exclude
  unrelated local planning artifacts.
- Coordinator integrates and verifies the complete behavior before marking implemented.
- Two fresh blind reviews of the final full diff and coordinator acceptance checks follow
  integration; review fixes remain within this ticket unless material scope changes.
- Blockers: none; approvals recorded and planning committed as `9a8616f`.
- Concerns: stale task state after live updates; the interval before a task ID arrives;
  preserving existing standalone card tests while moving lifecycle ownership.
- Round 1 correctness review: supported P2 where locally started task A permanently masks
  newer task B returned by a job refetch. Fix and regression assigned to the worker; final
  integration verification and fresh blind reviews completed below. Design review had no findings.
- Review fix red: reproduced stale direct-writing link after real Apollo start/completion
  of A followed by queued B in refreshed job cache. Green: 27 focused tests passed, including
  B progress, disabled writing, and B live completion. Worker commit `875349f`, integrated
  as `a33ac6f`; typecheck/lint/diff checks passed.
- Fresh review round 2: correctness and design found no actionable findings against the full
  original-base-to-`a33ac6f` application diff. Each independently passed 27 focused tests.
  Coordinator final integrated typecheck/lint passed; no production changes after reviews.
- Post-fix full serial suite: 154 passed, 1 failed across 35 files. The sole failure was
  unchanged InterviewSetPage.test.tsx queued/live subscription behavior; isolated rerun
  passed all 3 tests. Final comparison-focused checks: 27 passed. No unrelated code fixes.
- PR publication blocked by automatic approval review of the push to the configured GitHub
  origin; reviewed branch and prepared PR description are ready for explicit publishing approval.

## Delivery shape

One vertical slice is sufficient because the dialog, card, and resume action must agree on
one lifecycle. Splitting those controls into separate implementation tickets would create
an intermediate state that still permits writing during comparison. There are no blocking
edges or parallel writer opportunities. The coordinator owns integration, progress records,
two blind reviews, PR creation, and the human QA handoff described in the plan.
