# 01: Keep interview Q&A vectors current after future saves

**What to build:** Embed each future saved nonblank interview answer with its question in
the background. Keep only the current Q&A, update on edits, and remove it on clearing,
successful replacement, or deletion. Saving and feedback keep their existing behavior.

**Blocked by:** None.

**Status:** implemented

- [x] Separate storage, one unique question reference, combined question/answer content,
  configured model/dimensions, digest and source revisions; no search or backfill.
- [x] Successful nonblank saves schedule question-specific work after commit across all
  practice types, including unchanged saves and saves made by feedback requests.
- [x] Failed saves and rollbacks preserve valid vectors and enqueue no work.
- [x] Edits/clears/replacements invalidate vectors transactionally; deletion cascades.
- [x] Provider work occurs outside owner locks; stale results cannot restore obsolete data.
- [x] Duplicate jobs converge without duplicate rows or unchanged repeated provider calls.
- [x] Contact masking, temporary failure retries, missing-key handling, and ownership work.
- [x] Old untouched answers remain unembedded; library storage/search/grants remain isolated.
- [x] Approved Rails embedding exception and accounting limitation documented in relevant rules.
- [x] TDD evidence and actual Docker checks cover the approved plan's nine acceptance criteria.

## Progress and Verification

- Plan and breakdown approved in conversation; see parent plan for content hashes.
- Base: `413d4bcc5a70d50a40614c348cdab0bff6c72c92`.
- Branch: `work/vectorize-question-and-answers-01-sync-interview-qa-embeddings`.
- Worktree: `/tmp/careergrind-interview-qa-01`.
- Worker commit: `93a9ef9`; integrated as `991897c` after inspecting the full implementation diff.
- Observed red/green cycles: missing save scheduling -> scheduled after commit; missing
  generated row -> persisted combined vector; edits/clears retaining old vectors -> immediate
  invalidation; successful replacement retaining old vector -> transactional cleanup.
- Worker Docker migration passed. Worker focused suite: 106 examples, 0 failures.
- Worker full `docker compose -p resume_project run --rm --no-deps api bundle exec rspec`:
  422 examples, 0 failures. Subsequent focused refinements: 17 examples, 0 failures;
  final save/job checks: 5 examples, 0 failures. Changed Ruby RuboCop: 15 files, no offenses.
- Orchestrator integration command:
  `docker compose run --rm --no-deps api bundle exec rspec spec/services/interview_prep spec/jobs/interview_prep spec/models/interview_question_embedding_spec.rb spec/lib/ai_reader_access_spec.rb`:
  107 examples, 0 failures, including real commit/rollback and separate-connection races.
- Orchestrator search regression command:
  `docker compose run --rm --no-deps ai pytest tests/test_library_search_scope.py tests/test_library_embedding_search.py tests/test_tailor_resume_handler.py -q`:
  23 passed, no skips; no AI source changes in this ticket.
- `git diff --check` passed; no browser automation or real provider calls.
- Initial sandbox Docker inspection lacked socket access; elevated Docker commands are needed.
- Independently assessed plan criteria 1–9 using save/lifecycle/sync/transaction/job/model/
  replacement/access specs plus implementation inspection. No remaining requirement gaps.
- Round 1 blind correctness review: no actionable findings, independently 107 examples passed.
- Round 1 blind design review: supported P2 test gap; duplicate-worker test could execute
  sequentially. Orchestrator added backend readiness and observed database blocking before
  releasing provider work. Production code unchanged. Normal concurrency specs: 3 passed.
- In-memory mutation removing serialization: expected 1 example, 1 failure at the blocking
  assertion. Two initial mutation-runner setup failures were corrected and are not red evidence.
- Final integrated `docker compose run --rm --no-deps api bundle exec rspec`:
  423 examples, 0 failures. Changed concurrency spec RuboCop: 1 file, no offenses.
- Review-driven test fix: `0b3230a`. Fresh blind round 2 inspected the complete diff from
  `413d4bc` through `0b3230a`: correctness and design both clean. Correctness reran 107
  examples, 0 failures; design RuboCop checked 15 changed Ruby files, no offenses.
- [PR #8](https://github.com/JarrodNB/resume_project/pull/8) ready for human review/manual QA.
  No merge or deployment. Implemented is not human acceptance.
