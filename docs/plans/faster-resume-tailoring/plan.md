# Faster resume tailoring: completed draft

Status: plan revision 1 and ticket breakdown revision 1 approved; implementation starting.

## Problem Statement

Writing a resume currently alternates between approving a section and waiting for the next
one. One observed local session took 7 minutes 8 seconds, with about 5 minutes 25 seconds
inside the worker. It made 140 screening requests. An experience validator falsely rejected
supported wording and triggered a 102-second retry. Education required an 88-second model
request merely to choose the single degree already stored in the library.

The user wants a complete draft they can review and edit together, with fewer waits and
less repeated preparation. These observations describe one run, not a latency guarantee.
Private source transcripts remain local and are not committed into planning artifacts.

## Human Decisions

Settled in this conversation on October 18, 2026:

- Generate a completed draft; users edit all sections directly and save once.
- Copy education and certifications from the career library. AI chooses skills and writes
  summary, experience, and projects. Contact continues to come from the profile.
- Feedback-based AI regeneration remains the separate tailored feedback loop item.
- If generation cannot finish after applicable retries, fail the draft and offer retry.
  Do not present successful fragments as a completed resume.
- Omit an optional section when nothing relevant fits and explain the omission. Empty
  library sections are skipped automatically.
- The app is not in production. No compatibility path for unfinished section-by-section
  tasks is required. This does not authorize deleting or resetting development data.
- Track this work as the Kanban item named in this document.

The user confirmed shared understanding of the complete proposed scope, including manual
section exclusion, on October 18, 2026. That confirmation does not constitute approval of
this written plan or a ticket breakdown.

## User Stories

- As a job seeker, I start tailoring and receive one complete draft without approving each
  section before the next is written.
- I edit the draft, preview it, and explicitly save it without changing my career library.
- I understand when a section was deliberately omitted and when generation failed.
- I can retry a failed run and reload a completed draft or saved resume.

## Solution

Keep queued generation and the existing complete-draft editor. Replace the approval loop
with one execution that prepares evidence, assembles copied sections, generates the written
sections, and returns a completed result. Independent written sections run concurrently;
the summary follows the selected content so it reflects the resulting resume.

Show a clear whole-draft loading state until the complete result is ready. Do not add token
streaming, partial-draft editing, or per-section progress messages. Keep the existing PDF
preview and saved-resume editing behavior. Existing section editors permit direct changes;
manual section exclusion should be available before the first save so copying credentials
does not force every credential onto the final resume.

Generation failures and intentional omissions are different outcomes. A failed required
operation yields no completed result. A successful optional writer returning nothing-fits
omits its section with a section-specific explanation. No write-anyway pause remains.

## Implementation Decisions

- Put complete-draft preparation and assembly in the tailoring module behind one useful
  interface returning sections and warnings. The queue handler coordinates task input,
  dependencies, and result publication; callers do not manage section sequencing.
- Prepare from one user-scoped job/library read and the task's contact, gap-analysis, and
  gap-response snapshots. Preserve retrieval relevance and fallback when embeddings are
  absent; avoid pulling unrelated evidence into every section's prompt.
- Screen the union of selected source inputs once per execution, with bounded concurrency
  and existing chunking, confidence, privacy, and fail-closed rules. Keep an exact mapping
  from approved source strings to bound prompts; never turn an approved bundle into blanket
  approval of unscreened constituent text. Retain direct-input guardrails.
- Share screening decisions only inside the current execution. Retry deliveries rescreen.
  Do not add persistent approval caches or change the Jev model or decision threshold.
- Start with a small fixed concurrency limit for provider work. Ensure async execution
  preserves privacy, screening, usage, and transcript contexts. A task-wide deadline must
  stop and await outstanding work before reporting its final outcome.
- Generate experience, projects, and skill selection independently when their inputs exist.
  Generate summary from selected evidence/content afterward, screening any newly assembled
  reused text before it enters a prompt. Keep source labels attached through validation.
- Copy all saved education and certification entries, preserving identity, date precision,
  and descriptions. Do not describe an expired or uncertain credential as current. Copying
  data for display does not exempt any text later used in a model prompt from screening.
- Fix false name matching for sentence-opening verbs and mixed-case technology names.
  Preserve checks for unknown labels, invented names and numbers, and unsupported claims.
  Keep the model's valid rewrite rather than replacing it with library prose.
- Preserve the completed result shape: `result.sections` contains ordered objects with
  `section_type`, `title`, and `content`; `result.warnings` contains user-facing strings.
  New tailoring runs move from queued to completed or failed without needs-user-input.
- Remove obsolete tailoring section-submit/reopen actions, input state, UI, and associated
  GraphQL mutation where unused. Keep shared needs-user-input support for other workflows.
  Regenerate GraphQL schema/types when that interface changes.
- Keep Rails as the only domain writer. Final save remains explicit, authorized, and once
  per task. Preserve result and usage idempotency, including late usage reports after failure.
- Do not reset existing records. Saved resumes and completed drafts retain their result shape.
  Compatibility for paused old tasks is deliberately outside scope.

## Testing Decisions

Use observable interfaces and Docker, with synthetic data and external providers stubbed
at their interfaces for offline tests. Behavior changes follow red-green-refactor.

- Handler tests: one task yields a complete ordered draft without an approval pause;
  copied sections require no writer call; empty inputs skip unnecessary work; irrelevant
  optional sections produce explanations; missing jobs and failed writers never complete.
- Preparation/generation tests: unique selected inputs are screened once; shared evidence
  remains available to all relevant writers; blocked required inputs stop generation before
  embedding; rejected optional evidence is absent from prompts and citations. Verify bounded
  overlap with controlled async barriers rather than fragile wall-clock thresholds.
- Deadline/accounting tests: failure cancels outstanding work; privacy and task context
  survive concurrent calls; completed and failed provider requests retain accurate usage;
  new executions do not reuse old screening approvals.
- Validator regressions: supported Qdrant and GraphQL wording passes; invented technology,
  metrics, proper names, and labels remain rejected. Use synthetic source text.
- Rails tests: enqueue contract, completed-result handling, duplicate delivery, tenant
  isolation, final save, and protection against repeat saves.
- UI tests: loading, complete editable draft, omission warnings, section exclusion, saving,
  failure/retry, reload, and saved-resume editing. Do not use browser automation.
- Adapt tailoring evals to production-written sections and retain deterministic checks for
  copied credential/date behavior. Run relevant live evaluations after agent/prompt changes.

Existing useful seams include `handle_tailor_resume_task`, the agent's model interface,
`find_section_problems`, `process_task_message`, Rails tailoring services and
`ApplyAiResultService`, and `TailorResumePage` with GraphQL test responses. Reuse these;
do not add tests that merely assert private helper calls.

## Architecture Decisions

- Complete-draft generation replaces the tailoring-specific pause/resume protocol.
- Preparation owns screened evidence and exact prompt binding. Individual writers receive
  only the inputs they need; the frontend receives the complete draft, not internal state.
- Concurrency is internal to one queued task and remains bounded. SQS still delivers one
  task at a time to a worker; this does not introduce synchronous generation over HTTP.
- Record the replacement rationale in the career-library architecture guide and update
  affected scoped instructions. Keep schema types independent of runtime orchestration.

## Rollout Risks and Other Risks

- Provider latency varies. Removing known waits does not establish a hard response-time SLA.
- One execution now performs more work under the existing 240-second deadline. Verify the
  critical path, cancellation, usage reporting, and retries rather than simply raising the
  timeout past the queue visibility window.
- Concurrent failures can hide secondary charges or leave requests running unless explicitly
  awaited and accounted for. This is a required failure-path check.
- A narrower validator fix must preserve detection of invented claims.
- Copying every credential may add irrelevant entries; users can exclude them before saving.
- Existing unfinished tasks may be unusable after the old flow is removed. Accepted by the
  user's instruction not to spend effort on existing development data; do not delete it.

## Observable Acceptance Criteria

1. Starting tailoring requires no section approvals and produces one complete editable draft.
2. Contact, education, and certifications require no generative model request; copied fields
   preserve their stored meaning and credential date precision.
3. Experience, projects, and skill selection overlap where possible, with a bounded request
   count in flight; the summary reflects selected resume content.
4. Selected shared input is screened once per execution and all prompt-bound untrusted text
   has real screening coverage. A separate attempt starts fresh.
5. Empty source sections cause no writer requests. Nothing-fits sections are omitted with an
   explanation and no write-anyway prompt.
6. A failed required generation never appears as a successful partial draft. Retry remains
   available, with existing transient automatic retry rules and accurate attempt usage.
7. Supported Qdrant and GraphQL wording passes validation without the observed false retry;
   regression cases for invented claims still fail.
8. Users can edit or exclude draft sections, preview the draft, and save once. Later editing
   changes resume snapshots, leaving the career library intact.
9. Duplicate result delivery cannot replace a finished outcome or create duplicate resumes;
   usage remains independently deduplicated and tenant isolation remains intact.
10. Obsolete tailoring approval actions are removed, relevant docs/contracts are current,
    and offline checks plus relevant live quality evaluations have truthful recorded outcomes.

## Dependencies and Verification

The local Compose services are running. Docker access was verified using `docker compose ps`.
No application tests or live evaluations have run for this change yet. Credentials remain in
ignored environment files; do not print or copy secrets into artifacts or worktrees.

Planned checks, narrowed to final affected files during implementation:

```bash
docker compose run --rm ai pytest -m "not db" tests/test_tailor_resume_handler.py tests/test_tailoring_screening.py tests/test_check_section_faithfulness.py
docker compose run --rm ai pytest -m "not db" tests/test_screening_session.py tests/test_task_usage_accounting.py tests/test_task_usage_guardrails.py tests/test_run_limits.py
docker compose run --rm ai pytest tests/test_schema_dependencies.py
docker compose run --rm ai ruff check .
docker compose run --rm api bundle exec rspec spec/services/resume_tailoring spec/services/ai_tasks/apply_ai_result_service_spec.rb spec/services/ai_tasks/record_attempt_usage_spec.rb spec/graphql/mutations/resume_tailoring_spec.rb
docker compose run --rm api bin/rails graphql:schema:dump
docker compose run --rm --no-deps web npm run codegen
docker compose run --rm --no-deps web npm test -- src/features/resume-tailoring
docker compose run --rm --no-deps web npm run typecheck
docker compose run --rm --no-deps web npm run lint
docker compose run --rm ai python -m evals.run_tailoring_evals
```

Run additional relevant screening/retrieval evaluations if those behaviors change. Live
evaluations incur provider costs and must use synthetic or anonymized cases. Summarize
actual elapsed time, request counts, retry counts, and quality results; do not claim a
measured speedup from offline tests alone or commit private transcripts as benchmarks.

Human QA: start tailoring with a representative populated library; review the complete
draft and warnings; edit/exclude sections; preview and save; reload and edit the saved resume.
Also check a sparse library and failure/retry behavior. Compare the wait and output quality
to the observed old flow. Visual and manual checks belong to the human.

## Out of Scope

AI regeneration with feedback, career-library regeneration, ATS scoring, import fixes,
model shopping, changes to screening policy, persistent screening caches, partial-draft
recovery, token streaming, compatibility migration for paused tasks, data resets, deployment,
and merging the PR.

## Additional Notes

Planned feature slug: `faster-resume-tailoring`.
Planned integration branch: `work/faster-resume-tailoring`.
Use separate implementation worktrees and TDD subagents after both required approvals.
Two fresh blind reviewers will inspect the same committed candidate independently.

## Delivery Record

- Source: KANBAN.md, “Faster resume tailoring: completed draft”.
- Phase: both approvals received; preparing the planning commit and isolated implementation.
- Next: commit approved artifacts on master, create the integration branch, start 01, 02, and 04.
- Human decisions: recorded above from actual replies. The user's “confirmed” response
  confirms the scope including section exclusion. A later “confirmed” directly answered
  “Do you approve plan revision 1?” and establishes plan approval on October 18, 2026.
- Plan approval: revision 1 approved. Approved content SHA-256:
  `7a72268b503e90e5ccf8cd240224b81cc47e49920fe38adf4c32c396d6292444`.
  Hash covers Problem Statement through Additional Notes, excluding status and delivery record.
- Ticket breakdown: revision 1 in tickets.md approved by the user's “approved” response to
  “Do you approve breakdown revision 1?” on October 18, 2026. Approved content
  SHA-256: `acad7a974989b95f832550351580dbb56c8b61abe0118aef192dfdffa2f31691`.
- Planning commit: not created. Current checkout: master; preserve unrelated changes.
- Integration base/head and worker branches: not created.
- Ticket dependencies/statuses: 01, 02, and 04 ready-for-agent;
  03 blocked by 02; 05 blocked by 03 and 04; 06 blocked by 01, 03, and 05.
- Actual verification: source/log inspection; Docker services confirmed running. No tests run.
- Reviews, PR, and manual QA: not started.
- Known external blockers: none established; credentials and worktree test setup remain to
  be checked when needed. The existing local transcript stays ignored and private.
- Planning artifact tracking: KANBAN.md and docs/plans/ are ignored by Git. Explicitly stage
  the approved plan and tickets when creating the required planning commit; leave unrelated
  ignored files alone.
