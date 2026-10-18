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

**Status:** implemented

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

Actual: worker red failed because saved sections had no Summary toggle; green passed
after adding remembered collapse with parent-owned drafts. Worker broader check: 22 tests
in 5 files passed; typecheck and lint passed (0 warnings/errors). Coordinator reran the
same 22 tests on integrated commit `9641a89`: all passed. Actual test command used an
existing Docker image with explicit checkout mounting (no network or environment files):
`docker run --rm --network none -v <worktree>/apps/web:/app -v /app/node_modules -w /app resume_project-web:latest npm test -- src/features/resume-tailoring src/features/resumes`.
Worker typecheck/lint used the same image/mount pattern with their npm scripts.
Human visual QA remains pending for theme, viewport, spacing, and control appearance;
no browser automation.

**Progress:** Worker `presentation`; branch `work/tailor-page-styling-01-editor-presentation`,
worktree `.worktrees/tailor-page-styling-01`, base `19623f0`. Worker commit `3bfb8a6`,
integrated as `9641a89`. Coordinator inspected the integrated presentation diff. Saved
state stays above unmounted panels; draft inclusion and existing keys remain intact.

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

**Status:** implemented

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

Actual: deletion red failed on missing mutation (3 examples), then green 3/3. Start/save
guard red had 3 expected failures among 30 examples; combined green 45 passed. Accepted
repeat-save and usage-cap resumption already passed and remain regression coverage.
Worker final suite: 159 examples, 0 failures, including all intended Rails paths plus
deletion request auth, AI-task services, interview-prep services, and schema freshness.
Focused RuboCop: 12 files clean. Schema dump, web codegen and web typecheck passed.
Coordinator integrated rerun: 151 examples passed (same scope except existing
`spec/graphql/mutations/resume_tailoring_spec.rb`; covered by worker final suite).
Actual new specs: `spec/graphql/mutations/delete_resume_spec.rb` and
`spec/requests/delete_resume_spec.rb`. Checks used Docker image `resume_project-api:latest`
with explicit worktree `/rails` mount, test env and isolated `tailor02_default` database;
see plan for reusable command. No live AI evals required.

**Progress:** Worker `delete_contract`; branch `work/tailor-page-styling-02-delete-contract`,
worktree `.worktrees/tailor-page-styling-02`, base `19623f0`. Worker commit `d6498a4`,
integrated as `d45f63e`. Coordinator inspected mutation/service/schema/generated diffs.
Existing destruction service is sufficient; no redundant deletion service added.

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

**Status:** implemented

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

Actual: first red failed because Delete resume control was missing (4 existing tests
passed); green passed after hook/dialog/action integration. Final worker focused suite:
46 tests across 6 files passed, including both destinations, orphan deletion,
cancel/network/payload errors, edit retention, pending duplicate prevention, cache cleanup,
no auto-start during deletion, accepted-history replacement and start-failure retry.
Worker typecheck and lint passed with 0 warnings/errors. Commands used
`docker run --rm --network none -v <worktree>/apps/web:/app -v /app/node_modules -w /app resume_project-web:latest`
with the intended npm scripts. Coordinator production build (includes TypeScript) and
lint passed; bounded full frontend suite passed 166 tests across 35 files. The first
unbounded run had one unchanged interview-prep timeout; isolated test and bounded rerun
passed without code changes (details in plan).
Human visual/manual QA remains pending; no browser automation.

**Progress:** Worker `delete_flow`; branch `work/tailor-page-styling-03-delete-flow`,
worktree `.worktrees/tailor-page-styling-03`, base `8b9c439`. Tickets 01 and 02 integrated
and verified before assignment. Worker commit `40eaa0b`, integrated as `69f9c4d`.
Coordinator inspected hook/cache/route/start-history changes before broader verification.

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
