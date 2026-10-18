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

### Acceptance audit

- Criterion 1: code inspection confirms existing tone/icon/theme/card conventions and
  wrapping action layout; production build passed. Human theme/viewport appearance QA
  remains pending, so visual acceptance is not claimed.
- Criterion 2: editor/page tests cover grouped actions, editing, exclusion/restoration,
  preview/save parity and errors; unchanged drag-field code and shared drag tests checked.
- Criterion 3: saved-section collapse, retained edits, and remembered-open regression passes.
- Criterion 4: both route tests cover saved-only deletion, cancel, pending, failure/retry;
  unsaved draft keeps its existing action surface without Delete.
- Criterion 5: GraphQL/request specs cover owned section deletion, source/history retention,
  foreign/missing IDs and authentication. Frontend tests cover cache cleanup and destinations.
- Criterion 6: frontend checks no generation on deletion and fresh accepted-history start;
  Rails checks fresh task plus immutable acceptance and repeat-save rejection.
- Criterion 7: Rails/frontend orphan deletion tests pass.

### Integration verification

- Coordinator Rails rerun: 151 examples passed. Worker broader Rails suite: 159 passed,
  including the existing tailoring mutation spec omitted from coordinator rerun.
- Coordinator production build (includes TypeScript) passed; lint 0 warnings/errors.
  Vite reported a non-fatal large bundle warning; bundle splitting is outside this change.
- First coordinator full frontend run: 165 passed, 1 failed; unchanged interview-prep
  live-completion test timed out waiting for Question 1 while the build ran concurrently.
  Isolated rerun: all 3 InterviewSetPage tests passed without changes. Full rerun with
  `npm test -- --maxWorkers=2`: 166 tests passed across 35 files; no timeout/test settings
  were changed in source.
- Actual Docker web checks use explicit checkout `/app` mount, anonymous node_modules
  volume, `resume_project-web:latest`, `--network none`. Rails checks use explicit `/rails`
  checkout mount, `resume_project-api:latest`, `tailor02_default` network and local
  postgres test credentials with `RAILS_ENV=test` and local dummy AWS configuration.

### Progress

- Slug: `tailor-page-styling`.
- Phase: PR opened; human review and visual QA pending. Explicit public destination/payload
  authorization received in chat (`yes`) on 2026-10-18. Automated acceptance and both blind
  reviews complete.
- Scope: styling/collapse decisions and deletion behavior confirmed in chat.
- Plan revision 1 approved explicitly in chat on 2026-10-18 (`approved`). Approved file
  SHA-256 before this delivery-record update:
  `f9a3ef29bae391a8401dc6d4131811384e9020c152ea0e6733c0b521e32433c5`.
- Breakdown revision 1 approved explicitly in chat on 2026-10-18 (`approved.`). Approved
  tickets file SHA-256: `8790e2d47e82b6464ff0a48cb9deec6e5bdfbdeecfbe67253a90c7d7dd663dc6`.
  Revision 1 is in `tickets.md`: Ticket 01 presentation and
  collapse behavior; Ticket 02 deletion/start contract; Ticket 03 delete UI and navigation,
  originally blocked by 01 and 02; all three are now integrated.
- Planning commit and integration base: `19623f0`. Initial integration head: `19623f0`.
- Integration branch: `work/tailor-page-styling`, checkout
  `.worktrees/tailor-page-styling-integration`.
- Ticket 01: `work/tailor-page-styling-01-editor-presentation`, checkout
  `.worktrees/tailor-page-styling-01`, base `19623f0`, worker `presentation`.
  Worker commit `3bfb8a6`, integrated as `9641a89`; coordinator rerun 22 frontend tests
  passed. Worker red/green confirmed; types/lint passed. Visual QA pending.
- Ticket 02: `work/tailor-page-styling-02-delete-contract`, checkout
  `.worktrees/tailor-page-styling-02`, base `19623f0`, worker `delete_contract`.
  Worker commit `d6498a4`, integrated as `d45f63e`. Worker final 159 Rails examples passed,
  12-file RuboCop clean, schema/codegen/typecheck passed. Coordinator rerun 151 Rails
  examples passed (worker also covered existing tailoring GraphQL examples).
- Ticket 03: `work/tailor-page-styling-03-delete-flow`, checkout
  `.worktrees/tailor-page-styling-03`, base `8b9c439`, worker `delete_flow`.
  Worker commit `40eaa0b`, integrated as `69f9c4d`. Worker final 46 tests passed,
  types/lint clean. Coordinator production build/lint passed; full frontend rerun 166 passed.
- Environment: Docker daemon requires sandbox escalation; permission granted for checks.
  Existing dev images available. Rails checks use isolated `tailor02_default` network,
  local postgres test database. No provider calls or browser QA.
- Review round 1: base `19623f0`, candidate `252faa100cea6c484f0b261580fefeecad68fc75`.
  Fresh blind workers `correctness_r1` and `design_r1`, each in its own detached worktree.
  Both prohibited from reading plans/tickets/board/reports/rationale/commit messages or
  each other's findings. Both returned no actionable findings.
  Correctness: 159 Rails examples and 22 editor tests passed; diff whitespace clean.
  Design: 46 frontend tests, typecheck, lint passed; checkout clean. Rails statically
  reviewed by design; no browser/visual QA. Correctness traced concurrency protections
  without a separate concurrent-request stress test; external transports mocked.
- Reviewed integration code head: `252faa100cea6c484f0b261580fefeecad68fc75`; integration
  ref: `work/tailor-page-styling`. Only delivery records changed after this freeze.
  Coordinator inspected those editorial changes; another review round is unnecessary
  because behavior, interfaces, dependencies, source, and tests are unchanged.
- Implementation checks recorded above. Publishing attempted twice and rejected by
  automatic approval review. After the first rejection, GitHub connector verified the
  signed-in user `JarrodNB` owns repository ID `1415027277`, has admin/push permission,
  and its clone URL matches origin `https://github.com/JarrodNB/resume_project.git`.
  The repository is public. The second rejection stated that ownership is verified but
  public egress requires explicit trusted-user authorization for this payload/destination;
  workflow/plan/breakdown approval was deemed insufficient by automatic approval review.
  No branch push or PR creation occurred. No workaround attempted. Local delivery-record
  commit before blocker: `2cfc524`; reviewed source remains `252faa1`.
- Explicit permission now covers publishing this implementation, tests, schema/generated
  types, and planning records on `work/tailor-page-styling` to the existing public
  `JarrodNB/resume_project` repository and opening the PR against master. Local Git push
  was permitted but failed because no HTTPS credentials are configured. Use the
  authenticated GitHub connector to publish a snapshot commit, verifying its Git tree
  equals the local tree. Remote commit identity/history will differ; source remains the
  reviewed candidate. Preserve local commits and record both heads.
- Publication: authenticated connector uploaded 33 files, each verified against its local
  Git blob hash. Initial published snapshot `4390599b7c65986296deecf3632c810d90379506`
  has tree `02bdffa67c17c1e65ecd814809ff517bfb897e49`, identical to local commit
  `398b91e015eb308893c62540ae440318989da41e`. Local Git history is preserved separately.
- PR: https://github.com/JarrodNB/resume_project/pull/21 (open, attached to this chat),
  branch `work/tailor-page-styling`, target `master`. No merge or deployment performed.
- Master advanced to `1b1379b5eb2fa253730021f7f21e4d237f667ca1` during publication.
  Local integration merged it as `0b8215d`; incoming changes are only `.gitignore` and
  unrelated lower-screen-calls planning records. Application source/tests remain the
  reviewed candidate. Publish a matching merge tree with both remote parents to resolve
  the initial snapshot's add/add planning-record conflict. No behavioral review or test
  rerun required for this editorial reconciliation; full diff inspected.
- Next: human QA using the checklist above and in the PR. Retain board item until explicit
  completion confirmation. No further implementation or review is needed unless the
  candidate changes materially.
  Manual QA pending: light/dark and narrow/wide styling; edit/collapse/exclude/restore,
  preview/save; cancel/confirm deletion from both routes, including orphan resume;
  verify job/list updates and no AI work until deliberately choosing Write resume again.
- Exploration: clean `master` checkout; no existing artifacts for this item. Inspected
  tailor/saved editors, resume routes/queries, job navigation, task start/save services,
  existing deletion conventions, theme/card components, and testing/architecture guidance.
