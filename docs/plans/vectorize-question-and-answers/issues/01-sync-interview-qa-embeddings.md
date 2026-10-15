# 01: Keep interview Q&A vectors current after future saves

**What to build:** Embed each future saved nonblank interview answer with its question in
the background. Keep only the current Q&A, update on edits, and remove it on clearing,
successful replacement, or deletion. Saving and feedback keep their existing behavior.

**Blocked by:** None.

**Status:** in-progress

- [ ] Separate storage, one unique question reference, combined question/answer content,
  configured model/dimensions, digest and source revisions; no search or backfill.
- [ ] Successful nonblank saves schedule question-specific work after commit across all
  practice types, including unchanged saves and saves made by feedback requests.
- [ ] Failed saves and rollbacks preserve valid vectors and enqueue no work.
- [ ] Edits/clears/replacements invalidate vectors transactionally; deletion cascades.
- [ ] Provider work occurs outside owner locks; stale results cannot restore obsolete data.
- [ ] Duplicate jobs converge without duplicate rows or unchanged repeated provider calls.
- [ ] Contact masking, temporary failure retries, missing-key handling, and ownership work.
- [ ] Old untouched answers remain unembedded; library storage/search/grants remain isolated.
- [ ] Approved Rails embedding exception and accounting limitation documented in relevant rules.
- [ ] TDD evidence and actual Docker checks cover the approved plan's nine acceptance criteria.

## Progress and Verification

- Plan and breakdown approved in conversation; see parent plan for content hashes.
- Base: `413d4bcc5a70d50a40614c348cdab0bff6c72c92`.
- Branch: `work/vectorize-question-and-answers-01-sync-interview-qa-embeddings`.
- Worktree: `/tmp/careergrind-interview-qa-01`.
- Resulting commits: pending. Red/green evidence and checks: pending.
- Initial sandbox Docker inspection lacked socket access; elevated Docker commands are needed.
- Integration and concerns: pending.
