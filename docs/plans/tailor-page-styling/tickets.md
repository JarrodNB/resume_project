# Tailor page styling and deletion — breakdown revision 1

This breakdown implements plan revision 1. Human plan approval was received in chat on
2026-10-18. Breakdown revision 1 was explicitly approved in chat on 2026-10-18.
Ticket numbers remain stable. Actual checks and commits will be recorded here after approval.

## Ticket 01 — Consistent tailor and saved-editor presentation

**What to build:** Present loading, generation, errors, draft editing, and saved editing
with the existing section tones, icons, and card conventions. Group Preview and Save;
make saved sections collapsible without losing edits. This is independently demoable
on both existing editor routes.

**Blocked by:** None.

**Layers:** Web UI and frontend tests; affected web guidance.

**Modularity:** Reuse existing visual conventions. Share cohesive editor presentation
where helpful without moving draft inclusion or saved persistence out of their owners.
Keep editable state above collapsed panels. Use stable resume-specific saved-section IDs.
Prefer editor-local styling over changing shared import fields. Test page/editor behavior
through existing Testing Library seams; mock only the PDF rendering boundary.

**Status:** ready-for-agent

**Acceptance Criteria:**

- Both editors use app section styling and responsive, wrapping actions in light/dark themes.
- Loading, failure/retry, warnings, save errors, and pending save have clear presentation.
- Preview and Save are grouped. Existing exclusion/restore, field editing, drag order, and
  preview/save content parity remain intact.
- Saved sections start collapsed, remember open state, and preserve unsaved edits after
  closing/reopening. Existing draft collapse keys and behavior remain intact.
- No PDF redesign or changes to generation/persistence contracts.

**Verification:** Add and run a failing observable collapse/edit-retention test before
implementing behavior, then make it green. Keep existing editor/page regression tests green.
Do not add class-string tests for visual styling. Intended commands:

```bash
docker compose run --rm --no-deps web npm test -- src/features/resume-tailoring src/features/resumes
docker compose run --rm --no-deps web npm run typecheck
docker compose run --rm --no-deps web npm run lint
```

Actual red/green and broader results: not run. Human visual QA remains pending for theme,
viewport, spacing, and control appearance; no browser automation.

**Progress:** Unassigned. Intended branch `work/tailor-page-styling-01-editor-presentation`.
Separate worktree, starting integration head, resulting commits: pending. No known blocker.

## Ticket 02 — Owned deletion and fresh tailoring after deletion

**What to build:** Expose authenticated resume deletion and allow a fresh tailoring task
when an accepted task remains but its saved resume has been deleted. Deliver the behavior
through the GraphQL interface, including generated client types for the next ticket.

**Blocked by:** None.

**Layers:** Rails GraphQL/services and specs, schema, generated web GraphQL artifacts,
tailoring architecture notes and affected API guidance.

**Modularity:** Authorize through `current_user.resumes`; keep mutation thin and deletion
in a service, reusing existing destruction machinery where sufficient. Delete section
snapshots through existing model ownership. Keep task acceptance/history and usage records.
Inspect start/save locking and preserve the existing single-save invariant. Test services
and public GraphQL operations with factories, fake queues, and no provider calls.

**Status:** ready-for-agent

**Acceptance Criteria:**

- `deleteResume(id: ID!)` follows existing payload/error conventions and deletes only the
  current user's resume plus sections. Foreign/missing IDs and unauthenticated access fail.
- Deleting a resume preserves its job, career library, and accepted tailoring task/history.
- A resume whose job has been removed is also deletable.
- Explicitly starting after deletion queues a fresh task instead of returning the accepted
  task. A remaining saved resume still blocks duplicate generation.
- Previously accepted tasks cannot be saved again; existing resumable draft behavior and
  duplicate-start protection remain valid.
- Schema and generated client types reflect the mutation; no hand-edited generated files.

**Verification:** TDD one observable behavior at a time: owned deletion, access isolation,
preservation/orphan behavior, and replacement generation with acceptance guards. Verify
the actual failure is missing behavior, not setup. Intended commands:

```bash
docker compose run --rm api bundle exec rspec spec/graphql/mutations/resume_tailoring_spec.rb spec/services/resume_tailoring
docker compose run --rm api bin/rails graphql:schema:dump
docker compose run --rm api bundle exec rspec spec/graphql/schema_dump_spec.rb
docker compose run --rm --no-deps web npm run codegen
docker compose run --rm --no-deps web npm run typecheck
```

Include any new deletion spec paths and focused Rails lint. Actual red/green and broader
results: not run. No live AI evals required.

**Progress:** Unassigned. Intended branch `work/tailor-page-styling-02-delete-contract`.
Separate worktree, starting integration head, resulting commits: pending. No known blocker.

## Ticket 03 — Confirmed deletion on both saved-editor routes

**What to build:** Let users confirm deletion from either saved editor, recover from
errors, return to the agreed destination, and choose Write resume again later.

**Blocked by:** Ticket 01 and Ticket 02. Builds on the final saved-editor action layout
and generated deletion contract; avoids concurrent edits to those surfaces.

**Layers:** Web data hooks, confirmation UI, route integration, Apollo cache, frontend
tests, affected web guidance.

**Modularity:** Keep persistence/cache work in a focused hook and confirmation separate
from it. Let routes own return destinations. Reuse the shared saved-editor action surface.
Update tailoring restoration/start logic to treat accepted tasks without a saved resume
as history, never as an unsaved draft. Preserve non-deleted saved and resumable draft flows.

**Status:** ready-for-agent

**Acceptance Criteria:**

- Both `/jobs/:id/tailor` and `/resumes/:id` offer Delete resume only for a saved resume.
- Confirmation explains permanent resume/section deletion and preservation of the job and
  career library. Cancel sends no mutation. Pending confirmation prevents repeat requests.
- Mutation/network errors leave the resume editable and confirmation retryable.
- Success removes stale list/job/resume cache references and returns to the job from the
  tailor route, or `/resumes` from the resume route, including orphan resumes.
- Deletion/navigation itself sends no generation request. A later Write resume action
  starts a fresh task; reloading that active task restores it correctly.
- Existing save, preview, collapse, exclusion, and failure/retry flows remain green.

**Verification:** TDD through page interactions for cancel, pending, failure/retry, both
destinations/cache updates, orphan deletion, and deliberate replacement generation.
Use existing router/Apollo test helpers and mocked PDF boundary. Intended commands:

```bash
docker compose run --rm --no-deps web npm test -- src/features/resume-tailoring src/features/resumes src/features/jobs/JobDetailPage.test.tsx
docker compose run --rm --no-deps web npm run typecheck
docker compose run --rm --no-deps web npm run lint
```

Actual red/green and broader results: not run. Human visual/manual QA remains pending.

**Progress:** Unassigned. Intended branch `work/tailor-page-styling-03-delete-flow`.
Separate worktree, starting integration head, resulting commits: pending. Waiting for
Tickets 01 and 02 to be integrated and verified before assignment.

## Coordinator integration and handoff

After both approvals, commit planning artifacts on master and create
`work/tailor-page-styling` from that commit. Tickets 01 and 02 can run concurrently in
separate worktrees; integrate sequentially and verify each before starting Ticket 03.
Workers must not edit these tickets, the plan, board, integration branch, or PR.

The coordinator verifies every plan acceptance criterion and the integrated cross-layer
checks, then commits a candidate for two fresh blind correctness/design reviewers.
Resolve supported findings and repeat reviews after substantial fixes. Record actual
snapshots, results, limitations, and PR/manual-QA handoff in the plan. Do not merge, deploy,
or remove the board item without the required human instruction.
