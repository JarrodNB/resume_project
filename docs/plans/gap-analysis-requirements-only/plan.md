# Gap analysis: requirements only and whole-library screening

## Problem Statement

Gap analysis currently assesses job responsibilities alongside qualifications. This adds
irrelevant comparisons and generation work. It also screens each career-library entry
separately, so even many short entries require many sequential provider requests.

## Human Decisions

- Compare only saved requirements and nice-to-haves. Do not infer qualifications from
  responsibilities. A job with neither has nothing to compare.
- The database is fresh; no migration or historical-result compatibility is needed.
- There is no fixed runtime target.
- Screen the entire career library together using the same chunking path as resume import.
- Stop the analysis if library screening blocks or cannot complete; do not omit entries
  and continue with an incomplete library.
- Keep the behavior in a cohesive module behind a small interface and a thin handler.

## User Stories

- As a candidate, I see how my evidence matches required and preferred qualifications.
- As a candidate, I avoid waiting for a separate safety request for every small library entry.
- As a candidate, I receive a clear failure if my library cannot be safely compared.

## Solution

Remove responsibilities from gap-analysis inputs sent to screening and generation, assessment
kinds, instructions, summaries, evaluators, and the comparison view. Keep saved job
responsibilities and their use by other features. Both Rails enqueue validation and the
worker reject jobs containing only responsibilities. Nice-to-have-only jobs remain valid.

Assemble the complete library into one deterministic structured source, including summary,
experiences and highlights, projects, education, certifications, skills, and library facts.
Pass it through the existing shared screener with whole-document phrase-check behavior,
as import does. Inputs fitting the configured chunk size require one provider request;
larger inputs use the existing overlapping chunks and stop on rejection. Screen the reduced
job context separately before the library. Generation starts only after both pass.

## Implementation Decisions

- A gap-analysis context-preparation module owns source projection/serialization, screening,
  approved-source reconstruction, exact prompt binding, size checks, and screening usage.
  Its public operation takes context and screening configuration and returns the prepared
  prompt plus usage, or a typed failure retaining usage. Choose concrete names during
  implementation; do not expose intermediate sequencing to the handler.
- Reuse `screening.screen_user_text` and execution-local `screening.session` coverage.
  Do not introduce another classifier or copy chunking, confidence, masking, deadline,
  caching, or accounting policy. Disable the short-note phrase filter for assembled sources.
- Render all untrusted prompt values from the exact screened source arguments. A library
  approval must cover the whole serialized library; do not grant approvals to constituent
  entries by substring matching or caller assertions.
- Retain the existing 80,000-character screening-source cap and 120,000-character final
  prompt cap. Reject oversized sources before provider work; do not truncate. Document
  that the library cap now applies to the assembled source rather than each entry.
- Keep existing evidence labels and deterministic evidence attachment. The summary remains
  background, not citable evidence. Preserve all qualified library entries after approval.
- Keep interview entry-screening behavior scoped to interviews. Do not change other callers
  of the existing shared entry-selection helper as part of this work.
- Remove obsolete gap-only fact-screening hooks if no remaining caller needs them; inspect
  callers first. Update affected local guidance and architecture documentation.
- Keep the current model and reasoning effort. No dependency change is expected.

## Testing Decisions

Use small red/green cycles at observable interfaces, with provider fakes at the boundary.
Existing seams include Rails `StartGapAnalysisService` specs, AI prompt/handler tests,
`test_gap_context_screening.py` real-agent/provider-fake tests, output-validation/evidence
tests, and frontend card/parser tests.

Cover mixed jobs, nice-to-have-only jobs, and responsibility-only rejection without enqueue
or model calls. Check prompts and results contain only R/N requirements. Verify a whole
small library uses one screening request and a larger library follows configured overlap
without skipping text, including a blocked later chunk. Verify rejection, missing credentials,
provider error, oversize input, deadline and usage-cap behavior prevent generation and retain
actual billed usage. Verify the bound prompt avoids a second assembled-prompt screen;
unknown direct prompts remain guarded, and later deliveries screen again. Preserve evidence
mapping, order, certification dates, and adjacent-skill verdict coverage.

Update gap eval cases/evaluators to expect only requirements and nice-to-haves. Include
responsibilities in synthetic inputs to prove their exclusion. Verify the result view and
parser accept the narrowed contract and keep counts, evidence, responses, and warnings working.

## Architecture Decisions

Context preparation owns the complete safety-to-prompt operation; the worker reads context,
coordinates preparation/generation, and returns a queue result. Shared screening owns its
policy. The prompt builder and evidence attachment remain deterministic. Rails still owns
domain writes, and analysis remains asynchronous and read-only on the AI side.

No new queue envelope, database migration, or GraphQL field is planned. The JSON task-result
assessment kind narrows to `required | nice_to_have`; mirror it in Python and TypeScript and
audit downstream tailoring readers. Record this scoped behavior in the career-library
architecture guide; a separate ADR is unnecessary unless exploration reveals a larger decision.

## Rollout Risks and Other Risks

- One rejected library chunk now stops the whole analysis, as explicitly requested.
- Serialized metadata consumes part of the library source cap. Do not silently raise limits.
- Fewer requests should reduce repeated call overhead, but long libraries still need chunks;
  provider latency and generation retries vary. Do not promise a particular speedup.
- Fresh-database deployment requires coordinated producer/consumer updates; no legacy
  responsibility-result migration is included.

## Observable Acceptance Criteria

1. Mixed jobs yield assessments only for requirements and nice-to-haves, in posting order.
2. Responsibility-only jobs are rejected by Rails and by the worker before paid calls.
3. Nice-to-have-only jobs remain analyzable.
4. All library content is screened as one source using the existing import chunking policy;
   fitting sources use one call rather than one call per entry.
5. A blocked, unchecked, oversized, or incomplete library screen prevents generation, with
   a useful error and truthful usage accounting. No partial library is analyzed.
6. Approved exact prompts are not screened again; unknown input and repeat deliveries retain
   their existing protection.
7. The UI shows only the two qualification groups; evidence and saved responses still work.
8. The handler uses the preparation module through a small interface without managing its
   internal serialization, coverage, or screening sequence.
9. Synthetic before/after request counts and timing results are recorded with their limits.

## Dependencies and Verification

Run checks in the implementation worktree using Docker, following `docs/testing.md`:

```bash
docker compose run --rm api bundle exec rspec spec/services/gap_analysis/start_gap_analysis_service_spec.rb spec/graphql/mutations/analyze_job_gaps_spec.rb
docker compose run --rm ai pytest -m "not db" tests/test_analyze_gaps_handler.py tests/test_gap_context_screening.py tests/test_build_gap_analysis_prompt.py tests/test_find_gap_analysis_problems.py tests/test_gap_analysis_evaluators.py tests/test_schema_dependencies.py
docker compose run --rm ai ruff check .
docker compose run --rm --no-deps web npm test -- src/features/gap-analysis
docker compose run --rm --no-deps web npm run typecheck
docker compose run --rm --no-deps web npm run lint
docker compose run --rm ai python -m evals.run_gap_analysis_evals
```

Add focused tests for the new module and affected evidence/downstream readers as needed.
Run shared screener tests and affected interview tests to check isolation. Paid evals require
configured provider credentials; report missing access as a limitation. The existing gap
eval runner exercises generation but does not benchmark worker library screening. Use a
synthetic handler-level comparison to report screening counts, screening time, generation
time, retry counts, and total processing time on the same fixtures/configuration before and
after. Distinguish provider measurements from deterministic fake-delay measurements.

Manual QA is for the human: run a mixed job, expand both qualification groups and evidence,
save a gap response, rerun, and try responsibility-only and nice-to-have-only jobs. Verify
clear screen-failure messaging. No browser automation.

## Out of Scope

Historical-result migration, changing job extraction/classification, changing other feature
screening policies, parallel screening, model changes, retrieval-based library filtering,
import behavior changes, merging, deployment, and clearing the board without human acceptance.

## Additional Notes

The shared screener defaults to 4,000-character chunks with 300-character overlap. Import
uses that path too; whole-input screening does not guarantee a single network call.

## Delivery Record

- Source: Kanban item “gap analysis, should not be doing responsibilities, only requirements
  and nice to have's”; description “is also taking too long”.
- Phase: all tickets integrated, acceptance checked, both blind reviews clean. Next action:
  publish PR, then await human review and manual QA.
- Human decisions: recorded above from this conversation, including explicit confirmation
  that library screening failure stops analysis. These are not plan/breakdown approvals.
- Plan approval: human said “approved” on 2026-10-18 for plan SHA-256
  `6bdb6f98b2208c2544a6dcd023c59b873bad06e52bec3c2dccb2807082fd2303`.
  Breakdown approval: human said “confirmed” on 2026-10-18 for tickets SHA-256
  `508b7bb8b399024f34c6e93f71a60926b67bc714dd7fa231c92145e2e3a059b6`.
- Planning commit and integration base: `25d45c5911f3eaf2b4ff3079ab18e73a6544a00b`.
- Integration: `work/gap-analysis-requirements-only`, worktree `.worktrees/gap-analysis-integration`.
- Ticket 01 implemented by agent `qualifications`, branch
  `work/gap-analysis-requirements-only-01-qualifications`, worktree `.worktrees/gap-analysis-01`,
  starting at the integration base. Worker commit `64e1c3c` integrated as `cd7d659`;
  coordinator reran 64 AI and 12 frontend tests successfully. Worker also passed 20 Rails
  specs, frontend typecheck/lint and changed-file AI lint.
- Ticket 02 implemented by `library_screening`, branch
  `work/gap-analysis-requirements-only-02-library-screening`, worktree `.worktrees/gap-analysis-02`,
  base `ccfe3c4957ef0c8da397db7cc4c6302abdcac1cd`. Worker `e7dfb39` integrated as `3c95613`.
  Full offline AI suite: 542 passed, nine DB cases deselected. Coordinator integrated
  preparation/screen/handler/evidence/schema/queue-usage/interview tests: 89 passed.
- Ticket 03 implemented by `verification`, worktree `.worktrees/gap-analysis-03`, branch
  `work/gap-analysis-requirements-only-03-verification`, base `a9b3a320aa08a59420f5f8b69a71ebbb61b127a6`.
  Worker commits `82962bc`, `f0a2c78`, `9214343` integrated as `723c2df`, `8017a1f`, `b698490`.
- Coordinator final Rails check: 20 examples, zero failures, on disposable
  `gap-integration-test-db`. Integrated frontend typecheck and lint passed; lint zero warnings.
- Final live same-fixture sample: two screens, 7.852 s screening, 12.848 s generation (one
  request), 20.726 s total; estimated $0.000271. Synthetic counts: 19→2, 87→3, 87→5.
  Nine-case final paid gap eval completed with no task/evaluator errors: coverage/evidence
  validity/evidence recall/gap recall 1.0, verdict/met agreement 0.9444. Two verdict mismatches
  remain and also appeared in the original-source comparison. Original run had one screening
  outage, retried separately successfully. Final Python-tenure prose contains an arithmetic
  error. These model limitations are disclosed for QA; no quality gain is claimed.
- Original live synthetic baseline (base career library plus 12 synthetic skills): 19 screen
  calls, 91.325 s screening, 15.210 s generation (one request), 106.642 s total; configured
  `openai:gpt-6-luna`, low thinking; estimated $0.000692. Network-disabled provider-delay
  fixtures made 19/87/87 screening calls (small/many-short/multi-chunk). These are single
  observations, not latency guarantees. Reproducers/raw reports/results are retained in
  `verification/`, with the compact account in `verification/verification.md`.
- Full AI Ruff was reproduced on unchanged original source: four existing findings in
  `conversation_logging/__init__.py` and `tests/test_conversation_logging_reliability.py`.
- Blind correctness and design reviews completed in fresh no-history agents against the same
  source snapshot: base `25d45c5911f3eaf2b4ff3079ab18e73a6544a00b`,
  head `a9b3a320aa08a59420f5f8b69a71ebbb61b127a6`, isolated `.worktrees/gap-review-*`.
  Both returned no actionable findings. Correctness independently passed 542 offline AI
  tests, 61 focused AI tests, and 16 Rails specs. Design passed 53 focused AI and 12 frontend
  tests. Reviewers did not read planning/reporting context. Coordinator inspected later
  report-only edits and confirmed no production diff from this snapshot; another review
  round is unnecessary because only reporting/editorial text changed afterward.
- Coordinator acceptance audit: all nine criteria met through service/handler/source-boundary
  tests, UI tests, source inspection, and recorded request/timing comparisons. Model quality
  limitations above remain visible; acceptance is technical, not human completion.
- PR: pending. Git transport lacks push credentials; authenticated GitHub connector is
  available for publication. Remote master matches original source `6930b8e`.
- Checkout inspected: clean `master` before planning. Production changes are confined to
  the integration/worker worktrees; the primary checkout remains on the planning commit.
- Environment check: elevated `docker compose ps --format json` succeeded, no services running.
  Ordinary Docker access was denied by the sandbox; approved Docker access is available.
- Tests/evals/benchmarks: results above were obtained during implementation/verification,
  not planning. Detailed durable evidence is in `verification/verification.md`.
- Board: item retained pending explicit human acceptance.
