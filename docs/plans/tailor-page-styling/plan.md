# Tailor page styling and resume deletion

## Problem Statement

The resume tailoring page uses plain bordered sections instead of the app's established
section colors and headers. Preview and Save are separated, saved sections stay expanded,
and users cannot delete a saved resume.

## Human Decisions

- Match the career-library styling, with clearer section headers and grouped actions.
- Cover loading, generation, errors, draft editing, and saved editing. Shared editor
  improvements also apply at `/resumes/:id`.
- Preserve editing, exclusion, preview, and saving. Make saved sections collapsible.
- Add deletion on both saved-editor routes, with confirmation. Return to the job from
  `/jobs/:id/tailor`, or the resume list from `/resumes/:id`.
- Keep the job and career library. Allow a new resume for that job after deletion;
  generation starts only when the user chooses Write resume again.
- These scope decisions were confirmed in chat. They are not plan or breakdown approval.

## User Stories

- As a user, I can scan and edit my draft using the same visual language as my library.
- As a user, I can collapse saved sections and find Preview and Save together.
- As a user, I can confirm deletion of a saved resume and later write a fresh one for its job.

## Solution

Use the existing section tones, icons, theme tokens, and card conventions. Keep a single
column editor with responsive spacing and wrapping actions. Give loading and failure
states a clear card treatment; surface generation warnings and save errors near relevant
content and actions. Keep Preview and Save together; show pending save feedback.

Draft sections retain remembered collapse state and exclusion controls. Saved sections
start collapsed with stable resume-specific IDs, remember open state, and retain edits
when closed. Use shared presentation where it removes duplicated visual decisions while
keeping draft inclusion state and saved persistence in their existing owners.

Saved editors offer Delete resume. Confirmation explains that the resume and its saved
sections are removed, while the job and career library remain. Cancel does nothing.
Failures keep the dialog and editor available, with a retryable error. Disable repeated
confirmation while deletion is pending. On success, clear stale Apollo references and
navigate to the agreed destination without generating another draft.

## Implementation Decisions

- Data access stays in hooks; confirmation UI stays separate from persistence.
- Add an authenticated `deleteResume(id: ID!)` mutation following existing payload/error
  conventions. Resolve through `current_user.resumes` and delegate destruction to a
  service. Removing the resume destroys its section snapshots, including orphan resumes
  whose job was previously removed.
- Keep accepted tailoring tasks and `accepted_at` for history and usage accounting.
  Never reset acceptance or allow an old task to be saved twice.
- Update starting/restoring logic so an accepted task with no remaining saved resume
  allows a fresh task on a deliberate Write resume visit. An accepted task must not be
  rendered as an editable unsaved draft. Existing saved resumes continue to prevent
  duplicate generation. Inspect start/save concurrency together and serialize through
  the owning record where necessary to preserve these invariants.
- Preserve existing PDF generation, draft order, preview/save content parity, exclusion
  behavior, and saved editing contracts. No new dependency is planned.

## Testing Decisions

Use observable interfaces, with red/green tests for deletion, replacement generation,
and collapse/edit retention. Extend `TailorResumePage.test.tsx`,
`FinalResumeEditor.test.tsx`, and `features/resumes/ResumePage.test.tsx`; add focused
dialog/hook coverage only where page tests cannot meaningfully cover a failure path.
Mock the PDF boundary as existing tests do. Avoid tests that assert Tailwind class strings.

Extend Rails GraphQL/service specs using existing resume-tailoring and deletion examples.
Cover owner deletion, foreign/unauthenticated access, removed sections, preserved job and
library, orphan resumes, fresh generation after deletion, saved-resume blocking, and
rejection of repeat saves of previously accepted tasks. Cover cancellation, pending and
failure states, successful navigation/cache updates, and absence of automatic generation
after deletion through frontend tests.

Visual QA is human work: inspect light/dark themes and narrow/wide layouts, section
headers, controls, warnings/errors, loading, saved editing, and deletion confirmation.
No browser automation or browser-driven QA will be used.

## Architecture Decisions

Rails continues to own domain writes, with deletion rules in service objects. No queue
payload, AI worker, prompt, or model changes. Existing task history remains intact.
Update tailoring architecture notes and affected local guidance to describe deletion and
replacement generation. No new ADR is needed for this focused extension.

## Rollout Risks and Other Risks

- Cached resume links could remain after deletion; test both route destinations and
  revisiting the job/list.
- Existing accepted-task guards could block replacement generation or expose an empty
  tailor page; test reload and fresh-start paths explicitly.
- Collapse changes could lose unsaved edits; keep drafts above unmounted field panels.
- Shared field components also serve import/library views; prefer editor-local styling
  and check affected callers if shared markup needs changes.
- Deletion is permanent, so require explicit confirmation and show failures clearly.

## Observable Acceptance Criteria

1. Tailoring states and both editors use established app colors, cards, and spacing;
   controls remain usable in light/dark themes and narrow/wide layouts.
2. Preview and Save appear together; existing editing, drag ordering, exclusion/restore,
   preview/save parity, and error/retry behavior continue to work.
3. Saved sections start collapsed, remember toggles, and preserve unsaved edits.
4. Both saved-editor routes offer confirmed deletion; cancel preserves the resume and
   errors permit retry. Unsaved drafts do not offer saved-resume deletion.
5. Successful deletion removes only the owned resume and its sections, updates cached
   views, and navigates to the agreed destination. Foreign users cannot delete it.
6. Deletion does not trigger generation. Choosing Write resume again creates a fresh
   task; previous accepted tasks remain accepted and cannot be saved again.
7. Resumes without a remaining job can still be deleted from `/resumes/:id`.

## Dependencies and Verification

No external dependency is expected. Run application commands in Docker from each changed
checkout, using isolated worktrees for implementation and reviews.

Intended checks:

```bash
docker compose run --rm api bundle exec rspec spec/graphql/mutations/resume_tailoring_spec.rb spec/services/resume_tailoring
docker compose run --rm api bin/rails graphql:schema:dump
docker compose run --rm --no-deps web npm run codegen
docker compose run --rm --no-deps web npm test -- src/features/resume-tailoring src/features/resumes src/features/jobs/JobDetailPage.test.tsx
docker compose run --rm --no-deps web npm run typecheck
docker compose run --rm --no-deps web npm run lint
```

Include any new deletion specs, schema freshness checks, and relevant Rails lint under
repository conventions. Record actual commands and results during implementation.
No live AI evaluations are needed because AI behavior is unchanged.

## Out of Scope

PDF/export redesign, ATS checking, feedback regeneration, deleting jobs or career-library
records, discarding unsaved generation tasks, list-level bulk deletion, and a general app
redesign.

## Additional Notes

Source item: `jobs/id/tailor has poor styling`. Keep the item on `KANBAN.md` until explicit
human completion confirmation. The workflow ends at a reviewed PR and human QA.

## Delivery Record

- Slug: `tailor-page-styling`.
- Phase: approved for implementation. Next: planning commit, then isolated implementation.
- Scope: styling/collapse decisions and deletion behavior confirmed in chat.
- Plan revision 1 approved explicitly in chat on 2026-10-18 (`approved`). Approved file
  SHA-256 before this delivery-record update:
  `f9a3ef29bae391a8401dc6d4131811384e9020c152ea0e6733c0b521e32433c5`.
- Breakdown revision 1 approved explicitly in chat on 2026-10-18 (`approved.`). Approved
  tickets file SHA-256: `8790e2d47e82b6464ff0a48cb9deec6e5bdfbdeecfbe67253a90c7d7dd663dc6`.
  Revision 1 is in `tickets.md`: Ticket 01 presentation and
  collapse behavior; Ticket 02 deletion/start contract; Ticket 03 delete UI and navigation,
  blocked by 01 and 02. No implementation has started.
- Planning commit: pending approvals. Integration base/head: not created.
- Intended integration branch: `work/tailor-page-styling`.
- Implementation checks, blind reviews, PR, and manual QA: not started.
- Exploration: clean `master` checkout; no existing artifacts for this item. Inspected
  tailor/saved editors, resume routes/queries, job navigation, task start/save services,
  existing deletion conventions, theme/card components, and testing/architecture guidance.
