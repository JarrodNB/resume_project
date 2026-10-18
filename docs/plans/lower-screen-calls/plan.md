# Lower screening calls

Plan revision 1 and ticket breakdown revision 1 approved by the human.

## Problem Statement

Unchanged saved career information, job context, and interview inputs are screened again
on later AI tasks. Execution-local reuse already avoids many duplicate calls inside a task,
but it does not reduce repeated work across tasks. Users pay for those calls and wait for them.

There are already deterministic checks for blank input, size limits, and obvious instruction
overrides. These checks do not replace the model classifier for other text.

## Human Decisions

- Reuse successful screening across tasks for unchanged saved content and screening policy.
- Screen saved content on first AI use, rather than immediately after every save.
- Persist successful checks only. Rejections and unavailable checks may run again later.
- Temporary inputs still require screening before entering a model prompt and retain only
  execution-local reuse.
- Screening an uploaded resume does not approve its extracted or edited library records.
  Approval transfer from imports is explicitly outside this change.
- Keep batching multiple records into one classifier call separate.

The user confirmed the first four decisions in this chat and explicitly excluded import
approval transfer. These are requirements decisions, not approval of this written plan.

## User Stories

- As a user, I can run another comparison, tailoring task, or interview task without paying
  to screen the same saved source again under the same policy.
- When I change saved text, its next AI use checks the new content before generation.
- A screening outage or rejected source never becomes a durable approval.

## Solution

Add a user-scoped store of successful screening decisions owned by Rails. Python reads
existing decisions using its read-only database role and returns new successful decisions
through `ai_results`. Reuse matches the exact protected source content and screening policy,
never a record's general `updated_at`, a substring, or a client-provided approval flag.

Use a shared representation of saved sources across feature prompt builders. Each source
contains the untrusted fields needed by its callers, and trusted builders reconstruct their
prompts from checked source values. A source with a genuinely different set of fields needs
its own exact check; approval of a smaller source cannot cover additional text. Keep source
identity and rendering inside screening preparation rather than asking handlers to manage
cache sequencing. Library entries must not be bundled into one library-wide cache key:
editing one entry must not invalidate approvals for unrelated entries.

Cover saved library entries and profile summary, job inputs, saved gap responses, and saved
interview questions/answers used by gap analysis, tailoring, and interview preparation.
Only sources established by trusted server reads or server-created immutable snapshots are
eligible. Merely appearing in a queue payload does not make text eligible. Temporary draft
section snapshots, unknown direct agent input, and unknown history keep task-local screening.

## Implementation Decisions

- Store content digests and policy identities, not another copy of source text. Scope every
  lookup and write to the task owner. Add a unique constraint for idempotent insertion.
- Derive the digest from the exact privacy-protected source bytes that the classifier would
  receive. If masking changes the bytes, the prior decision cannot match.
- The policy identity includes an explicit revision and effective classifier configuration:
  primary/fallback models, classifier instructions and decision thresholds, phrase-check
  policy, chunk size/overlap, and applicable source limits. Changes must invalidate reuse.
- Keep cheap local blank/size/phrase rules active as appropriate before reuse. A cache hit
  must never bypass current limits or grant broader prompt coverage.
- Cache hits contribute no provider usage. Actual checks, validation retries, fallback,
  and partial failures retain existing usage accounting.
- Extend `AiResultMessage` with optional successful-screening reports, separate from domain
  `result` and usage. Reports carry bounded digest/policy metadata, not source text. Rails
  derives ownership from the existing AiTask, validates metadata, and inserts idempotently.
- Return completed successful source checks even when later generation fails or an execution
  requests retry. Handle reports independently of finished-task outcome changes, just as
  late usage is independent today. Duplicate/out-of-order reports cannot alter task outcomes.
- No approval is assumed until Rails has applied its report. Concurrent tasks or an immediate
  retry may both screen a source before persistence; cross-worker single-flight is excluded.
- Preserve exact prompt binding and the official input guardrail. Persisted source decisions
  populate current execution coverage through the same trusted source preparation path.
- Preserve current failure semantics: gap analysis requires its complete selected context;
  optional interview/tailoring entries may be omitted with warnings. Splitting gap screening
  into reusable source units must not turn a required failure into partial comparison.
- Restrict AI database grants to SELECT on the new decision store. No AI database writes,
  synchronous Rails classifier calls, or public GraphQL approval controls.

## Testing Decisions

Use observable provider requests, rendered inputs, queued reports, and saved rows as seams.
Existing examples include `test_screening_session.py`, `test_gap_context_screening.py`,
`test_tailoring_screening.py`, and `test_interview_screening_once.py`, plus Rails result
application and AI-reader access specs. Extend these seams rather than testing private helpers.

Required coverage:

- First use screens; a later task after report persistence makes zero classifier calls for
  identical eligible sources. Exercise sync and async paths and cross-feature reuse.
- Changing one entry checks that entry without checking unchanged unrelated entries again.
- Changed policy, masking, or extra source fields cannot reuse the old decision.
- Same text for another user cannot use this user's saved approval.
- Rejection, unavailable screening, partial chunk failure, and oversized input never create
  an approval. Current required/optional behavior remains observable.
- Unsaved text and unknown prompt/history still screen in each execution.
- A screened import does not approve its structured library output.
- Duplicate and late reports, failed generation, retry reports, and edits racing with result
  delivery preserve exact-content matching, task outcomes, and once-only usage accounting.
- Cache hits report no new classifier usage; misses retain actual billed work.

Use TDD for behavior changes, offline fake-provider tests, and Docker checks. Do not use
browser automation. Run relevant live synthetic screening evals if classifier/prompt behavior
changes; distinguish these paid quality checks from offline correctness verification.

## Architecture Decisions

Rails remains the source of truth for persisted decisions, and Python remains responsible
for screening policy and all classifier calls. A small shared screening interface hides
lookup, policy matching, execution coverage, and report collection. Feature builders retain
ownership of which evidence enters their prompts and which inputs are required.

Update `docs/architecture/ai-safety-and-usage.md`, `docs/architecture/ai-tasks.md`, and affected
local guidance, which currently explicitly prohibit approval persistence. Preserve schema
dependency direction: queue/data schemas must not import screening runtime modules.

## Rollout Risks and Other Risks

- Incorrect source coverage or stale policy identities could skip a necessary check; exact
  content matching and policy-invalidation regressions are essential.
- A shared source representation can accidentally change prompt evidence. Compare actual
  prompts and preserve job-field exclusions, grounding, retrieval, and required-input behavior.
- New rows accumulate with content revisions. Store compact metadata, avoid raw-text copies,
  and remove user-owned decisions with account deletion. A broader retention system is excluded.
- Deploy the additive Rails schema/result consumer before workers emitting/reading approvals.
  An empty store is valid and fills on first use; no provider-calling backfill is needed.
- Persistence is asynchronous, so this reduces repeated calls after reports are applied; it
  does not promise exactly one provider call globally under concurrent executions.

## Observable Acceptance Criteria

1. Repeated tasks reuse successful checks for unchanged saved sources under the same policy.
2. An edited source or changed policy requires screening again; unrelated saved sources reuse
   their approvals.
3. Reuse works across the named features when their exact checked source content is shared.
4. Temporary inputs and extracted import records receive their own checks as described above.
5. Rejected, unchecked, partial, and oversized sources cannot establish durable approval.
6. Tenant isolation, exact prompt coverage, required/optional failure behavior, queue duplicate
   safety, and actual usage accounting remain intact.
7. Saves enqueue no new screening work. AI database access remains read-only.

## Dependencies and Verification

Depends on the existing classifier, privacy masking, execution session, Rails result consumer,
and read-only database reader. No new external provider is required.

Intended checks (replace added-test placeholders with actual paths in tickets):

```bash
docker compose run --rm ai pytest -m "not db" tests/test_screening_session.py tests/test_gap_context_screening.py tests/test_tailoring_screening.py tests/test_interview_screening_once.py
docker compose run --rm ai pytest -m "not db"
docker compose run --rm ai ruff check .
docker compose run --rm api bundle exec rspec spec/services/ai_tasks spec/lib/ai_reader_access_spec.rb
```

Also run new persistence/reader tests and migration/schema checks appropriate to the final
implementation. Record actual results and limitations in the delivery record, not as assumed
passes. No GraphQL change is intended.

Manual QA: run an AI task using saved library/job content, repeat after its result is applied,
and inspect reduced screening requests/usage. Edit one relevant source and repeat. Exercise
interview feedback with an unchanged and then changed saved answer. Confirm results, omission
warnings, and saved answers still behave normally.

## Out of Scope

- Transferring uploaded-resume approval to extracted or edited records.
- Batching independent records into one screening request.
- Replacing JEV/Nano with deterministic acceptance or changing classifier thresholds.
- Screening on every save, caching rejections, global cross-user reuse, or distributed locks.
- New UI controls, feature regeneration, deployment, merging, or Kanban completion.

## Additional Notes

Source item: **Need to lower screen calls** in `KANBAN.md`. The separate item about tailoring
screening records one at a time remains separate. The checkout was clean on `master` during
exploration. No application code or infrastructure has changed.

## Delivery Record

- Phase: PR ready for human review/manual QA. Stop here until human feedback; no merge,
  deployment, or board removal authorized by publication approval.
- Requirements: settled in this chat; import approval transfer explicitly excluded.
- Plan approval: human said “confirmed” after presentation of revision 1. Approved file
  SHA-256 before delivery-record edits:
  `d4f35bc318e0555498c2a5f0d900632227c8106fdbc4517eae246494d73eebd7`.
- Breakdown approval: human said “confirmed” after presentation of revision 1; approved
  tickets SHA-256: `ff86149de202dc5703f1294a855d55be5eee2b95e87564699fc4734115806d1d`.
- Planning commit and integration base: `6c98a50` on master.
- Integration: `work/lower-screen-calls`, worktree `.worktrees/lower-screen-calls-integration`.
- Ticket 01 implemented: worker `4306fa5`, integrated `596a758`; isolated migration, 45 Rails
  examples and 25 Python checks passed. Coordinator reran both focused suites successfully.
- Ticket 02 implemented: worker `80e8c1f`, integrated `6c15555`; coordinator verification:
  118 focused offline tests and 1 real database isolation/grant test passed.
- Remote master `b485ed0` merged cleanly into integration. Original planning base stays
  `6c98a50`; PR/review diff will use current master to exclude unrelated merged work.
- Tickets 03–04 started in separate worktrees from `1b3dbf7`:
  `work/lower-screen-calls-03-tailoring` and `work/lower-screen-calls-04-interviews`.
  Ticket 04 interview slice: worker `d3b76d3`, integrated `fa23579`; coordinator verification
  97 Python tests and 91 Rails examples passed. Ticket 03: worker `d65e08c`, integrated
  `68f7eb0`; worker 70 Python/9 Rails checks passed. All tickets implemented after combined
  verification. Reviews and PR not started.
- Combined verification on integration: 665 offline AI tests passed, 10 DB tests deselected
  (119.78s); 455 Rails examples passed (24.73s); real database decision reader/grant test
  1 passed. All changed Python lint and whitespace checks clean. Full Ruff's 4 unchanged
  conversation-logging findings were reproduced against baseline, not fixed out of scope.
- Acceptance audit: criteria 1–3 covered by queued saved-source, gap-to-tailoring, and interview
  reuse tests; criterion 4 by temporary/unmarked snapshot and import non-transfer tests;
  criterion 5 by blocked/unavailable/partial/size regressions; criterion 6 by owner-scoped DB,
  prompt reconstruction, usage/retry/late/duplicate tests; criterion 7 by server snapshot
  producer specs and real read-only grant tests. Manual QA remains for the human.
- Live synthetic JEV suite: 4 correct completed cases, 10 provider timeouts, nonzero exit.
  A serial diagnostic repeat returned 5 correct completed cases and 9 timeouts, also nonzero.
  No wrong decisions among completed cases; this is not a passing quality suite. Keep as a
  handoff limitation. No threshold/timeout changes or further repeated provider calls.
- Implementation detail: durable identity represents the classifier decision. Current
  caller-specific phrase and size preconditions always run before reuse; phrase-list and
  classifier policy changes invalidate approval. This preserves existing local behavior
  while allowing cross-feature classifier reuse.
- Intended integration branch after both approvals: `work/lower-screen-calls`.
- Baseline verification: isolated Docker AI suite with networking disabled and synthetic
  `OPENAI_API_KEY=offline-test-key`: 627 passed, 9 database tests deselected (108.81s).
  An earlier run without that synthetic key failed at provider initialization; it is not
  evidence of implementation regressions. No real model requests or credentials were used.
  Git mutations and Docker need sandbox escalation, which is available. Existing development
  images are available; no unrelated worktrees or main-stack data were modified.
- Blind review snapshot: base `b485ed0f4ead7cce91e7698770a86cd945c6b28b`, candidate
  `1fde092ff4ee1af4e8f88e0412a0bc566fb48b33`. Fresh reviewers had no inherited conversation
  and were prohibited from reading the board, planning artifacts, commit messages, and
  implementation reports. Both returned no actionable findings.
- Correctness reviewer: focused 60 tests passed/1 DB deselected; full offline suite
  665 passed/10 DB deselected; diff check passed; full Ruff confirmed only the four
  unchanged conversation-logging findings. Rails/live/DB checks not run by reviewer.
- Design reviewer: focused 49 passed/1 DB deselected; no actionable architecture,
  maintainability, or test findings. Rails/live/DB checks not run by reviewer.
- Coordinator independently audited all seven acceptance criteria as recorded above.
  No review repairs were required. Subsequent workflow-record edits are editorial only;
  no second review round is required for unchanged source/test code.
- Publication blocker: automatic approval review rejected `git push -u origin
  work/lower-screen-calls`, citing private repository code egress to an unverified external
  GitHub destination. No push occurred. Explicit permission requested to push this reviewed
  branch to `JarrodNB/resume_project` and open its PR; do not bypass the rejection.
- Publication approval received: human selected “Approve push and PR” for the exact branch
  and `JarrodNB/resume_project` destination. Authorized shell push then failed because Git
  has no credentials. Connected GitHub app confirms repository owner and push permission;
  publish the exact reviewed file tree through that app and verify its SHA against local Git.
- PR: https://github.com/JarrodNB/resume_project/pull/22 on `work/lower-screen-calls`,
  targeting master `b485ed0`. GitHub confirms open, unmerged, and mergeable.
- Publication used the authenticated GitHub app: initial remote commit `c878afd3` has
  exact file-tree SHA `948ee3fd2df9016b3dd97c96193307140f68f110`, matching local snapshot
  `11df8fb`. Fetch/diff confirmed zero file differences. Only these final handoff records
  change afterward; reviewed production/test code remains unchanged.
- Preserve the original local integration commit history under
  `codex/lower-screen-calls-local-history` while aligning the integration branch with the
  app-published snapshot. Worker branches and blind-review snapshots remain available.
- Manual QA steps and rollout order are in the PR body. Live JEV timeouts and baseline Ruff
  findings are explicitly disclosed there. The disposable `screen01-db` test container was
  removed after verification; no main-stack data changed.
- Human acceptance/manual QA remain pending; leave item on board.
