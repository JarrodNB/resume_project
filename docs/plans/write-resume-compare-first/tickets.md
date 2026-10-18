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

**Status:** ready-for-agent (dispatch only after breakdown approval and planning commit).

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
Actual red/green and broader check results: not run; implementation pending approval.

**Progress:**

- Planned worker branch: work/write-resume-compare-first-01-comparison-flow.
- Worktree, starting base, resulting commits: not assigned; coordinator will record actuals.
- Coordinator integrates and verifies the complete behavior before marking implemented.
- Two fresh blind reviews of the final full diff and coordinator acceptance checks follow
  integration; review fixes remain within this ticket unless material scope changes.
- Blockers: human breakdown approval and approved planning commit pending.
- Concerns: stale task state after live updates; the interval before a task ID arrives;
  preserving existing standalone card tests while moving lifecycle ownership.

## Delivery shape

One vertical slice is sufficient because the dialog, card, and resume action must agree on
one lifecycle. Splitting those controls into separate implementation tickets would create
an intermediate state that still permits writing during comparison. There are no blocking
edges or parallel writer opportunities. The coordinator owns integration, progress records,
two blind reviews, PR creation, and the human QA handoff described in the plan.
