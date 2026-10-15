# Vectorize interview questions and answers

Specification and delivery record. Index: delivery state, problem, solution, user stories,
implementation decisions, testing decisions, acceptance criteria, scope, and handoff.

## Delivery state

- Source: top KANBAN.md item, “Vectorize question and answers.” Leave it on the board.
- Feature slug: `vectorize-question-and-answers`.
- Phase: ready for human review/manual QA; next action: human review of PR #8 and QA below.
- Integration branch: `work/vectorize-question-and-answers`.
- Integration base: `413d4bcc5a70d50a40614c348cdab0bff6c72c92`.
- Final code/test review HEAD: `0b3230a771f53d079e59a8d54d1afd03ae17f4e6`;
  final reviewers inspected the same full diff from the integration base.
- Branch created after retrying a timed-out automatic permission review.
- Plan approval: user said “ok continue then” after the revised-plan handoff, accepting
  the plan including test seams and the proposed Rails embedding exception.
  Approved plan SHA-256: `d279f63fddf8751ef4d09e7147c9722cc01eef91a2a0c34bc51629625591bf01`.
- Breakdown approval: user said “continue” after the single-ticket proposal.
  Approved breakdown is recorded in plan SHA-256
  `c5e75fef1664ee255a35f9fe350cb3ecbc773913240ec366c116a159aca2d364`.
- Ticket [01](issues/01-sync-interview-qa-embeddings.md): implemented and verified, no blockers.
- Worker branch: `work/vectorize-question-and-answers-01-sync-interview-qa-embeddings`;
  isolated worktree: `/tmp/careergrind-interview-qa-01`, base matches integration base.
- Verification: integrated focused suite 107 examples passing, final full API suite 423 passing,
  AI search regressions 23 passing. Detailed evidence is recorded on ticket 01.
- Reviews: round 1 correctness clean (107 checks passed); design identified insufficient
  synchronization in the duplicate-worker test. Strengthened the test to prove overlapping
  workers through PostgreSQL blocking evidence; it passes and detects removed serialization
  in an in-memory mutation run. Fresh round 2 correctness and design reviews both found no
  actionable findings. Correctness independently ran 107 passing examples; design ran
  RuboCop on 15 changed Ruby files with no offenses. No dismissed findings remain.
- PR: [#8 — Vectorize saved interview questions and answers](https://github.com/JarrodNB/resume_project/pull/8).
  Branch published. Human QA/acceptance pending. No merge or deployment authorized.

### Search compatibility update — 2026-10-15

- [PR #6](https://github.com/JarrodNB/resume_project/pull/6), commit `e390c24`, adds
  `LibraryFact` to library embedding validation and requires an explicit nonempty set of
  supported source types for each library search, filtered before ranking.
- PR #6 is merged into local `master` through `979d3e5`; the inspected checkout contains
  the explicit source-type search interface and corrected library model validation.
  This is related work, not a reason to combine storage.
- Keep the dedicated Q&A table. Do not add interview types to the career-library model
  validation, search allowlist, or tailoring's explicit type selection.
- This update clarifies compatibility; it does not approve the plan or authorize Q&A search.

### Task accounting compatibility update — 2026-10-15

- Latest commit `413d4bc` merges PR #7, retaining known provider costs across failed,
  retried, and late queued-task attempts. Usage reports have execution identities and do
  not change finished task outcomes. Query embeddings participate in this accounting.
- Independent Rails career-library embedding jobs remain outside queued-task accounting.
  Under this plan's proposed Rails exception, interview Q&A embedding jobs would likewise
  remain outside AI-task budgets and attempt reports. This is a proposed limitation for
  plan approval, not a claim that embedding requests have no provider cost.
- Do not manufacture an `AiTask` or attach interview-vector costs to a feedback task:
  saving an answer does not require feedback, and the embedding job has its own retries.
  Extending cost accounting to independent embedding jobs would be separate scope.
- Preserve PR #7's owner-before-task locking and feedback save semantics. No changes to
  its worker usage collector, result message contract, or accounting module are needed.
- Reviewed source against current HEAD; this compatibility update grants no approval.

### Human decisions — 2026-10-15

- Scope: “Interview practice questions and answers.”
- Purpose: “We are not actually searching them yet, i just want them vectorized.”
- Trigger: accepted embedding after saving a nonblank answer, without waiting for feedback.
- Lifecycle: accepted latest saved Q&A only, refreshed on edits and removed on clearing,
  successful question replacement, or set deletion.
- Existing answers: “Only vectorize future saves.” No backfill command or migration backfill.
- These responses settle requirements; they are not plan or breakdown approval.

## Problem Statement

Saved interview practice answers have no vector representation paired with their question.
The user wants those pairs vectorized now, without introducing search or treating practice
answers as career-library evidence.

## Solution

After a successful future save, vectorize the question and its nonblank saved answer together
in the background. Keep one current representation per question. Editing refreshes it;
clearing, successful replacement, and deletion remove it. Saving remains independent of
embedding provider availability. General, technical, and knowledge practice are included.

## User Stories

1. As a user, I want my saved question and answer embedded together to retain their context.
2. As a user, I want saving to complete without waiting for the embedding provider.
3. As a user, I want edits reflected in the stored vector rather than retaining old answers.
4. As a user, I want clearing or replacing an answer to remove its obsolete vector.
5. As a user, I want deleting a practice set to remove its Q&A vectors.
6. As a user, I want practice answers to remain separate from career-library evidence.
7. As a user, I want older answers left alone until I save them again.

## Implementation Decisions

- Use dedicated interview Q&A embedding storage with a unique question reference, ownership
  through the question's set, combined content, content digest, model, vector, and source
  question/answer revisions. Use cascading deletion for the question reference. Do not add
  interview rows to library embeddings, retrieval queries, or AI reader grants. No search
  index or search interface is needed yet.
- Keep Q&A ownership deterministic through the persisted question and its user-owned set;
  the LLM does not supply ownership. The existing library search remains scoped by the
  task's user ID, embedding model, and explicit library source types. Q&A storage does not
  alter those filters or tailoring's existing fallback/context rules.
- Format one text as `Question: <saved question>\nAnswer: <saved answer>`. Exclude coaching,
  example answers, and other questions. Preserve original content in storage; reuse existing
  contact masking for outbound embedding text.
- Reuse the existing embedding client and configured model/dimensions (currently
  text-embedding-3-small, 1536 dimensions), without new dependencies.
- **Proposed architecture exception, subject to plan approval:** extend the existing Rails
  embedding exception to interview Q&A. These are derived vectors without prompts, like
  career-library embeddings. Use a Rails background job; do not add a synchronous provider
  call to saving or a new SQS task/result contract. Update root and API rules and architecture
  documentation to make the expanded exception explicit during implementation.
- A successful nonblank save enqueues a question-specific job after transaction commit,
  including saves performed by feedback requests. This includes unchanged text saved again,
  allowing a pre-existing answer to become eligible through a future save. Invalid saves and
  rolled-back transactions enqueue nothing. Never scan all questions for a user's save.
- The job reads current persisted Q&A rather than trusting an old queued text snapshot.
  Skip duplicate work when the model and masked content digest already match.
- Avoid holding the owner lock during the provider call. Read a revision snapshot under the
  established owner lock, then recheck ownership, existence, text, and revisions under that
  lock before writing. Discard obsolete results so delayed jobs cannot restore cleared,
  replaced, edited, or deleted content. Current-state jobs may safely converge on newer text.
- Delete an existing vector in the same transaction as an actual answer edit, clearing, or
  successful question replacement; deletion cascades when a question/set/user is destroyed.
  Thus a pending refresh or provider failure cannot leave a stale vector presented as current.
- Retry temporary provider failures using the existing embedding-job policy. A missing key
  skips embedding with a log message; deletion and invalidation do not require a key. Saving
  and feedback keep their existing success/error behavior. Retry exhaustion requires a later
  save or explicit retry of that question's job; there is no historical sweep.
- Keep business logic in a small interview embedding module with a question-level interface
  and an injectable embedding client. Jobs remain thin; models hold associations/validations.

## Testing Decisions

- Main observable seam: save an authorized answer, execute its queued job with a fake
  embedding client, and inspect persisted combined content and vector metadata. Exercise
  the same save path used by feedback requests, including failures after the answer saves.
- Test the embedding module's interface with controlled provider responses for duplicate
  jobs, edits during provider work, late results after clearing/replacement/deletion, provider
  failure, and cross-user ownership. Assert behavior rather than private helper calls.
- Follow existing interview question-operation/replacement specs and embedding job/service
  specs. Use real database constraints for uniqueness and cascading deletion checks.
- Check that library embedding synchronization/retrieval remains isolated from interview Q&A.
  Exercise library sync with saved interview answers present: no interview embedding is
  created in `library_embeddings`. Preserve the search tests that reject interview source
  types and exclude other users/models, plus tailoring's explicit library type selection.
- Use TDD for approved behavior changes. No browser automation or browser QA.

## Observable Acceptance Criteria

1. Each future successful nonblank save can produce exactly one current vector for the
   combined saved question and answer, across all three practice types.
2. AI feedback is neither required nor embedded; a persisted answer remains eligible even
   when its subsequent feedback request fails allowance checks or enqueueing.
3. Repeated saves/jobs do not create duplicate vectors or repeat unchanged provider work.
4. Edits remove old vectors and asynchronously embed current content; clear/replacement/
   deletion remove vectors, and delayed jobs cannot recreate obsolete content.
5. Failed saves and rolled-back mutations do not launch embedding work or remove valid data.
6. Provider failure does not undo or block saving; temporary failures are retried. Missing
   configuration is logged and skips generation, while cleanup still succeeds.
7. Existing unsaved-again answers remain unembedded even when another question is saved.
8. No search behavior, library fact, library embedding row, or new AI reader access is added.
   Interview types stay outside the library validation/search allowlists and tailoring's
   selected types; existing user/model/type scoping is preserved.
9. User ownership and deletion constraints prevent cross-user writes and orphaned vectors.

## Dependencies and Verification

- Depends on existing Rails background jobs, PostgreSQL/pgvector, embedding configuration,
  and interview ownership/revision locking; no external research is required.
- Planned focused check: `docker compose run --rm api bundle exec rspec spec/services/interview_prep spec/jobs/interview_prep spec/models/interview_question_embedding_spec.rb`.
  New spec paths are proposed and must be reconciled with the approved ticket implementation.
- Planned regression check: `docker compose run --rm api bundle exec rspec`.
- Preserve merged PR #6's focused search regression checks:
  `docker compose run --rm ai pytest tests/test_library_search_scope.py tests/test_library_embedding_search.py tests/test_tailor_resume_handler.py -q`.
  These paths include the PostgreSQL checks; skipped database tests do not count as passed.
- Migration check: `docker compose run --rm api bin/rails db:migrate` plus schema inspection.
- Actual commands/results are recorded on ticket 01. Migration, integrated focused Rails
  checks, full worker Rails regression checks, and search regression checks passed.
  Prior PR #6 results are not counted as verification of this implementation.
- After implementation: independently check every criterion, then two fresh blind reviewers
  inspect the same fixed full diff. Record findings, fixes, and any repeated review rounds.

## Approved Ticket Breakdown

1. **01: Keep interview Q&A vectors current after future saves.** Blocked by: none.
   Deliver the complete saved-answer-to-background-vector flow, including isolated storage,
   combined content, contact masking, after-commit scheduling, latest-only refresh,
   transactional invalidation, cascade cleanup, stale-result rejection, retry/idempotency,
   and saves made by feedback requests. Cover all nine acceptance criteria with TDD and
   Docker checks. Update relevant instructions and architecture for the approved Rails
   exception and document the accounting limitation. No UI/search/backfill is included.

This is one cohesive question-level behavior, sized for one fresh implementation agent.
Its lifecycle and race handling share the same save/replace/delete paths; splitting storage,
job wiring, or tests into separate tickets would not yield complete observable behaviors.
No prefactoring or expand–contract migration is needed. Dependency graph: `01` only.
Ticket published and delegated in its isolated branch/worktree. Worker commit `93a9ef9`
was inspected and integrated as `991897c`. Orchestrator independently checked all nine
acceptance criteria against code and test evidence and ran the integrated focused suite.
Integration excluded unrelated shared-database schema drift and local research/skill edits.
Two rounds of blind reviews completed, with the supported test-coverage fix committed as
`0b3230a`. Final handoff-only documentation edits do not change source/tests/schema; another
review round is unnecessary. Local research and skill modifications remain uncommitted.

## Out of Scope

Search, retrieval consumers, career-library promotion, opt-in controls, UI changes, historical
vectors, backfills, feedback vectorization, model migration tooling, and merge/deployment.

## Further Notes and Manual-QA Handoff

- Human QA: save and edit answers in each practice type, request feedback, clear an answer,
  replace a question, and delete a set. Confirm normal UI behavior and inspect stored vectors
  after background work; there is deliberately no vector UI. Simulate a provider failure and
  verify the answer remains saved. Confirm an older untouched answer stays unembedded.
- PR/manual-QA handoff: [PR #8](https://github.com/JarrodNB/resume_project/pull/8) is ready.
  Tests use simulated provider responses; live OpenAI and production Solid Queue execution
  were not verified. Run human QA above; keep the Kanban item until explicit acceptance.
