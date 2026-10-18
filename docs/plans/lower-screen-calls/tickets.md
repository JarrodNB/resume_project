# Lower screening calls — tickets

Breakdown revision 1, approved by the human. Implements approved plan revision 1.
Ticket IDs are stable. No implementation has started.

All workers follow repository instructions and the workflow's red-green-refactor process.
Use separate worktrees based on the current verified integration head. Workers report
commits, changed files, actual failing/passing tests, acceptance outcomes, and concerns;
only the coordinator updates this file, the plan, board, integration branch, or PR.
Run checks in Docker without browser automation. Existing source/guardrail/provider tests
are the seams; do not mock away the cache or coverage behavior under test.

## 01 — Persist successful screening reports safely

**What to build:** Rails can receive successful screening metadata through `ai_results`,
save it once for the task owner, and expose it to the read-only AI role. This is an additive
foundation; existing workers and tasks continue to work without screening reports.

**Blocked by:** None.

**Layers:** Rails schema, models/associations, service objects, result application, reader
grants, Python queue schema, and focused API/contract tests.

**Modularity:** A dedicated Rails service owns metadata validation and idempotent insertion.
`ApplyAiResultService` coordinates it alongside existing task/usage handling. Ownership comes
from AiTask, never report-supplied user IDs. Define a bounded report contract with content
digest and policy identity, no raw source text. Keep schemas independent of runtime modules.

**Status:** ready-for-agent.

**Acceptance Criteria:**

- Required metadata and owner references have database constraints; duplicate owner/content/
  policy tuples produce one decision. Account deletion removes its decisions.
- Completed, failed, retry usage-only, and late finished-task reports can persist successes
  without changing established task outcomes or double-counting usage.
- Invalid metadata cannot establish approval or corrupt task accounting; specify and test
  deterministic rejection behavior compatible with queue redelivery.
- Old messages without reports remain valid. Reports contain bounded metadata only.
- AI role can SELECT the store, cannot write it, and retains existing access restrictions.

**Verification:** Intended commands:

```bash
docker compose run --rm api bin/rails db:migrate
docker compose run --rm api bundle exec rspec spec/services/ai_tasks spec/lib/ai_reader_access_spec.rb
docker compose run --rm ai pytest -m "not db" tests/test_schema_dependencies.py
```

Also run added persistence/queue-contract tests. Generate schema via Rails, never hand-edit.
Actual red/green evidence and command results: pending implementation.

**Progress:** Branch/worktree, starting base, commits: not assigned. No blockers beyond
breakdown approval. Integrate and verify before releasing ticket 02.

## 02 — Reuse saved source checks in gap analysis

**What to build:** A first comparison screens its saved sources and reports successes; a
later comparison after persistence reuses them. Changing one library entry requires checking
that entry while unchanged sources reuse their decisions.

**Blocked by:** 01.

**Layers:** Shared Python screening/source preparation, database reader, worker lifecycle,
gap-analysis preparation, tests, and screening/queue architecture guidance.

**Modularity:** Screening owns policy fingerprints, exact protected-content digests, lookup,
execution coverage, and report collection behind a small interface. Database SQL remains
in `database/`, scoped to the task user. Shared source preparation exposes checked values
to trusted renderers; callers must not manually seed allowed-source sets or manage cache
sequencing. Establish source units suitable for later tailoring/interview reuse, preserving
their field projections. Required complete gap context stays required.

**Status:** ready-for-agent.

**Acceptance Criteria:**

- Real worker execution publishes successful eligible-source reports, including before retry
  and after later generation failure. No completed checks are lost merely because generation
  fails. Usage-only and outcome messages use the ticket 01 contract.
- A later task with persisted matching decisions avoids classifier calls for those sources.
  No reuse crosses users, content, privacy-protected bytes, or effective screening policies.
- Policy identity covers the explicit revision, models, instructions/thresholds, phrase
  policy, chunks/overlap, and limits. Tests demonstrate meaningful invalidation paths.
- Gap analysis uses separate reusable saved source units instead of a library-wide approval.
  Editing an entry does not invalidate unrelated entries. A rejected required unit prevents
  generation; job responsibilities remain excluded from gap context.
- Current limits and phrase policy apply before reuse. Rejections, unavailable checks, and
  partial chunk passes never persist approval. Hits add no classifier usage.
- Exact prompt binding survives reconstruction; unknown direct inputs/history keep screening.
  Temporary input cannot be made eligible by merely placing it in a task input dictionary.
- Empty decision stores work without backfill. Races may cause duplicate provider calls but
  cannot cause incorrect reuse. No cross-worker lock or provider-calling save path is added.
- Update safety/queue docs and affected local instructions to describe the new contract.

**Verification:** Intended commands:

```bash
docker compose run --rm ai pytest -m "not db" tests/test_screening_session.py tests/test_screening_recovery.py tests/test_gap_context_screening.py tests/test_process_task_message.py tests/test_task_usage_accounting.py tests/test_prompt_guardrail.py tests/test_schema_dependencies.py
docker compose run --rm api bundle exec rspec spec/services/ai_tasks spec/lib/ai_reader_access_spec.rb
docker compose run --rm ai ruff check .
```

Add focused real-provider-seam cache/report tests and database reader tests, including a
database-backed owner-isolation check. Use existing fake providers, not paid model calls.
Actual red/green evidence and command results: pending implementation.

**Progress:** Branch/worktree, starting base, commits: not assigned. Design concern: preserve
prompt evidence and required-input semantics when replacing whole-library screening.

## 03 — Reuse checks while preparing complete tailored drafts

**What to build:** Tailoring reuses unchanged saved job/library/gap-response checks, including
shared sources checked by comparisons, and still screens temporary generated section inputs.

**Blocked by:** 02.

**Layers:** Python tailoring source/prompt preparation, trusted saved-snapshot eligibility,
any necessary Rails enqueue snapshot metadata, and focused tests/documentation.

**Modularity:** Use the shared source preparation interface from ticket 02. Tailoring owns
retrieval, labels, evidence selection, and prompt rendering; it must not duplicate cache
keys or persistence logic. Preserve the current bounded async checks and task deadline.

**Status:** ready-for-agent.

**Acceptance Criteria:**

- Repeated tailoring and comparison-to-tailoring flows avoid classifier requests for exact
  shared saved sources after reports persist; genuinely additional fields require checking.
- Changing one selected saved source checks the new source without invalidating unrelated
  entries. Include role/title changes affecting highlight context in regression coverage.
- Saved gap-response snapshots are eligible through trusted server provenance. Unsaved or
  generated selected-section snapshots keep execution-local checks.
- Reuse does not broaden retrieved evidence, alter stable labels, lose copied fields, or
  approve unchecked extra prompt values. Original required job/optional evidence behavior,
  omission warnings, faithfulness inputs, concurrency, deadlines, and usage remain intact.
- Async callers sharing the same source still share one execution-local decision. Cache
  hits carry no invented classifier usage. Imported records do not inherit upload approval.

**Verification:** Intended commands:

```bash
docker compose run --rm ai pytest -m "not db" tests/test_tailoring_screening.py tests/test_screening_session.py tests/test_gap_context_screening.py
docker compose run --rm ai ruff check .
```

Run existing complete-draft preparation/generation and handler tests discovered in the
worktree, plus added cross-feature regressions. If enqueue metadata changes, run focused
Rails tailoring service specs. Actual red/green evidence and command results: pending.

**Progress:** Branch/worktree, starting base, commits: not assigned. Can run alongside 04
after 02 is integrated; serialize any shared-source/worker edits that would conflict.

## 04 — Reuse saved interview inputs and verify the complete change

**What to build:** Interview generation/replacement/feedback reuse saved library, question,
and answer checks. Finish cross-feature regression coverage and document operational limits.

**Blocked by:** 02. Final combined verification also waits for integrated 03.

**Layers:** Python interview handlers/source preparation, trusted Rails interview snapshots
if needed, tests, and final architecture/local guidance.

**Modularity:** Use shared screening for decisions and reporting. Interview preparation owns
its saved revisions, excluded questions, grounding, and required/optional inputs. Do not add
screening persistence to domain models or change save-before-feedback behavior.

**Status:** ready-for-agent.

**Acceptance Criteria:**

- Repeated generation, replacement, and feedback reuse exact eligible saved sources;
  identical shared library sources reuse checks from the other features.
- Changed saved answers/questions require a check. Late results for old revisions never
  grant approval to different text or alter revision/outcome rules.
- Fact requirement exclusions and personal-fact/subject-accuracy scope remain intact.
  Answer saves survive screening/generation failures; required question/answer rejection
  still blocks feedback, while optional library omission retains existing behavior.
- Temporary/unknown input still screens; rejected/unavailable checks can run on later tasks.
- Regression coverage demonstrates tenant isolation, policy/content changes, late/duplicate
  reports, failure usage, import non-transfer, and sync/async reuse across the full change.
- Final documentation states asynchronous persistence and concurrent-call limitations,
  first-use behavior, rollout order, invalidation, and human manual-QA steps accurately.

**Verification:** Intended commands:

```bash
docker compose run --rm ai pytest -m "not db" tests/test_interview_screening_once.py tests/test_screening_session.py
docker compose run --rm api bundle exec rspec spec/services/interview_prep spec/services/ai_tasks spec/lib/ai_reader_access_spec.rb
docker compose run --rm ai pytest -m "not db"
docker compose run --rm ai ruff check .
```

Run relevant database-backed reader/persistence checks, and live synthetic evals only if
classifier/prompt behavior changes require them. Record paid-check configuration blockers
truthfully. Coordinator runs combined checks after 03 and 04 integrate, then audits all plan
criteria and conducts the workflow's two fresh blind reviews before PR handoff.
Actual red/green evidence and command results: pending implementation.

**Progress:** Branch/worktree, starting base, commits: not assigned. Can implement alongside
03 after 02; the coordinator owns final combined verification and review/PR records.
