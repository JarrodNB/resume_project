# Pasted job ads with an unknown company

## Problem Statement

An ad without an employer name can cause another LLM request because the parsing schema
and source checks require company text. Rails, the database, GraphQL, and downstream AI
job contexts also require a company. A parser-only fix would leave imported jobs unusable.

## Human Decisions

On 2026-10-17 the user agreed to store a missing company as null, display **Unknown
company**, allow adding it later through the job form, and keep the job title required.
These decisions are settled. The user approved the written plan in chat with
"confirmed" on 2026-10-17; the exact approved revision is recorded below.

## User Stories

- Save a pasted ad without a named employer without a retry caused by its absence.
- See that the employer is unknown and add its name later.
- Continue using the saved job for gap analysis, tailoring, and interview preparation.

## Solution

Allow company to be null throughout the saved-job workflow. The parser returns null
when the employer is unstated. A supplied company must still appear in the source ad;
title and bullet validation stay in place. Store null rather than a placeholder string.
Show Unknown company on job lists/details and leave the edit field empty. Allow manual
entry and editing without a company because they share the same Job contract.

## Implementation Decisions

- Update ParsedJobPosting, its prompt, source checks, posting conversion, and
  ScrapedJobPosting. Handle nullable values in length-limit normalization.
- Permit null on jobs.company through a migration and remove company presence
  validation. Retain required title and existing text limits. Career-library employers
  are unaffected.
- Normalize blank company input to null in Rails job services for create/update/import.
- Make GraphQL Job.company nullable; regenerate the schema and frontend types using
  their generators. The existing input argument already accepts null.
- Update the form, its values, import guidance, and errors that say company is required.
- Audit database readers, gap_analysis_context, screening, prompts, tailoring, interview
  preparation, and transcript labels. Accept absent company in job contexts and use
  readable missing-value text when needed, without writing that label as domain data.
- Keep behavior in the existing owning modules; no new orchestration layer is needed.

## Testing Decisions

Use synthetic ads and existing public test seams. Follow red-green-refactor for behavior
changes. A handler mock alone cannot establish that agent validation avoids retries.

- Exercise real parse-agent output validation with a fake provider returning null company;
  assert success with one model request. Keep invented-company and missing-title checks.
- Test posting conversion and task handling with null company, plus named-company cases.
- Test Rails import/result application, GraphQL reads and create/update: save null, add a
  name, clear it, and reject missing title. Preserve duplicate-result and tenant isolation
  behavior through existing application seams.
- Test downstream job context construction and affected prompt builders with null company.
- Test Unknown company in list/detail and optional company editing through React tests.
- Add a missing-company parse-eval case and adjust evaluators that assume strings.

Starting seams include AI tests/test_parse_job_posting_handler.py,
tests/test_posting_from_parsed_job.py, tests/test_job_posting_parse_evaluators.py, Rails
spec/services/jobs/create_job_from_pasted_posting_service_spec.rb, and the jobs UI tests.
Inspect existing agent tests and all applicable local instructions before implementation.

## Architecture Decisions

Rails remains the source of truth. Long-running work and results still use SQS.
scraped_job.company becomes nullable; GraphQL and downstream read models mirror it.
Preserve duplicate-delivery handling. Record the optional-company meaning beside job
ingestion in docs/architecture/career-library.md and update affected local guidance.

## Rollout Risks and Other Risks

- Apply the database migration and tolerant consumers before emitting null from the AI
  producer. Older consumers may reject the expanded contract.
- Reinstating the database constraint requires handling existing nulls explicitly; never
  delete jobs or invent employers to make rollback work.
- This removes retries caused by an absent company; other validation and provider errors
  still follow existing behavior.
- Prompt changes require the existing paid parse eval. Record credential or execution
  blockers honestly; offline tests do not establish model quality.

## Observable Acceptance Criteria

- [x] A valid titled ad without an employer imports with company null.
- [x] Null company causes no validation retry for an otherwise valid model response.
- [x] Supplied companies must still appear in the ad; named-company imports still work.
- [x] A missing title remains invalid.
- [x] Job list/detail show Unknown company; users can add or clear the company in the form.
- [x] GraphQL returns null successfully and generated types reflect that contract.
- [x] Existing AI job workflows accept null company without company-related failures.
- [x] Duplicate completion delivery still creates only one job.
- [x] Focused checks and eval results are recorded, including limitations.

## Dependencies and Verification

Follow docs/testing.md in the implementation worktree. Intended checks:

```bash
docker compose run --rm api bin/rails db:migrate
docker compose run --rm api bundle exec rspec spec/services/jobs spec/models/job_spec.rb
docker compose run --rm api bin/rails graphql:schema:dump
docker compose run --rm --no-deps web npm run codegen
docker compose run --rm ai pytest -m "not db" tests/test_parse_job_posting_handler.py tests/test_posting_from_parsed_job.py tests/test_job_posting_parse_evaluators.py tests/test_schema_dependencies.py
docker compose run --rm ai ruff check .
docker compose run --rm ai python -m evals.run_job_posting_parse_evals
docker compose run --rm --no-deps web npm test -- src/features/jobs
docker compose run --rm --no-deps web npm run typecheck
docker compose run --rm --no-deps web npm run lint
```

Add focused agent, GraphQL, result-application, and downstream checks based on actual
changes. Record actual commands and results. Human QA: paste a titled ad without an
employer, verify the saved job and label, add and clear its employer, and exercise normal
downstream workflows. Verify named-employer and missing-title behavior. No agent browser QA.

## Out of Scope

Optional titles, employer guessing, career-library employer changes, scraping redesign,
broad retry changes, unrelated UI changes, merge, and deployment.

## Additional Notes

Source item: **Job from pasting add issue**. Leave it on KANBAN.md until explicit human
completion confirmation. Use work/job-from-pasting-add-issue for approved implementation.

## Delivery Record

- Phase: implementation and blind reviews complete; preparing PR for human QA.
- Human behavior decisions: agreed in chat on 2026-10-17, as recorded above.
- Plan approval: user replied "confirmed" on 2026-10-17 to the written plan approval request.
  Approved file SHA-256 before recording approval:
  c508527025f1fa7bd5986e0f6009aa8129420f00b405148e422ff03203b2c6d4.
- Breakdown approval: user replied "confirmed" on 2026-10-17 to the breakdown approval request.
  Approved tickets.md SHA-256: 11a4c8c77ba3f5e01af8bdbd1749792ffb596712649bae1b4a4a1068eba3e657.
  Tickets 01 and 02 are sequential, with 02 blocked by 01.
- Planning commit: e47b1787c2cbf649b785d57ef3ff9d284f93b422 on master.
- Integration base: e47b1787c2cbf649b785d57ef3ff9d284f93b422. Branch: work/job-from-pasting-add-issue.
- Ticket 01 worker: work/job-from-pasting-add-issue-01-optional-company; worktree at /home/jarrod/resume_project_worktrees/job-from-pasting-add-issue-01.
- Verification: completed checks and limitations are recorded below.
- Reviews: both blind reviews clean; PR preparation in progress; human QA pending.
- Planning artifacts are ignored by /docs/plans/ in .gitignore. After breakdown approval,
  explicitly stage only this feature's plan and tickets for the required planning commit;
  leave the repository-wide ignore rule unchanged.

### Ticket 01 integration

- Worker commit: 00da44f96c6cb4c0af0000a7f96e18924c1f546e.
- Integrated commit: c25ec1628a5aeebc72c69ebfa5268cc718ebab33.
- Coordinator inspected changes and independently ran nullable-context/schema tests: 14 passed.
- Worker verification: API 71 examples passed; AI 106 passed; UI 38 tests passed;
  schema export/codegen, frontend types/lint, changed-AI lint, and diff checks passed.
- Red evidence: missing company rejected by Rails; original AI schema rejected None;
  original jobs view lacked Unknown company. Each regression passed after restoration.
- Full AI lint has four existing conversation-logging violations; not changed here.
- Ticket 01 implemented. Ticket 02 started from c25ec16 in isolated worktree
  /home/jarrod/resume_project_worktrees/job-from-pasting-add-issue-02 on
  work/job-from-pasting-add-issue-02-parse-unknown-company.
- Current phase: Ticket 02 implementation. Paid evals and final blind reviews pending.

### Coordinator integration verification

- API acceptance suite rerun against integration c25ec16: 71 examples, 0 failures.
  Docker used isolated unknown-company-01 network/database and read-only development
  bundle volume, with integration services/api mounted at /rails.
- Live synthetic evals completed with exit 0 using careergrind-pii-ai:latest, integration
  services/ai mounted at /app, and the ignored main development env file passed directly
  to Docker. No credentials were copied into worktrees or recorded.
- python -m evals.run_gap_analysis_evals: verdict_accuracy/met_agreement 0.935;
  evidence_validity, evidence_recall, and gap_recall 1.00.
- python -m evals.run_tailoring_evals: faithfulness, relevance, omission scores 1.00.
- python -m evals.run_library_retrieval_evals: HitAt1, RecallAtK, MRR 1.00;
  PrecisionAtK 0.125 (existing dataset measure, not a new regression pass threshold).
- These quality runs supplement deterministic null-company regressions; they do not
  replace them. Final pasted-ad eval still pending Ticket 02 integration.

### Final implementation and review snapshot

- Ticket 02 worker: 25215c635232483e0aa2604f9082b2f51dc2bcc4; integrated as
  1d1f60223ffea59f236c85249eb03715bc10ce1b. Both tickets implemented and verified.
- Real agent red/green: null-company response failed before the schema fix, then completed
  with exactly one parse-model request. Supplied-name and required-title checks still pass.
- Worker final checks: full offline AI 526 passed, 9 DB tests deselected; jobs UI 26 passed;
  changed task-copy rerun 3 passed; frontend types/lint and changed Python Ruff passed.
- Coordinator final integrated parser/context suite: 43 passed. Earlier integrated API suite:
  71 examples, 0 failures. No Rails code changed in Ticket 02.
- Correctness blind review: base e47b1787c2cbf649b785d57ef3ff9d284f93b422 to head
  1d1f60223ffea59f236c85249eb03715bc10ce1b; no actionable findings; 30 offline AI tests
  passed; caller/schema, migration, ownership, authorization and idempotency inspected.
- Design blind review: same base/head; no actionable findings; 38 offline AI tests and
  16 frontend tests passed; interface ownership and observable test coverage inspected.
- No review fixes required. Subsequent changes are delivery records/evaluation evidence;
  no production/test change after the reviewed snapshot, so another review pair is unnecessary.
- All automated acceptance criteria checked. Human visual/manual QA remains pending and
  does not follow from passing tests/reviews. Keep the Kanban item until human completion.

### Final parser quality evaluation

- Live parse runner completed exit 0 with the new unnamed-employer fixture. Every metric
  on that fixture scored 1.00. Each case had one Jev request and one parse-model request;
  the reported two requests include screening, not a parse retry.
- Initial five-case average posting_fields 0.800; extraction precision/recall 0.800;
  verbatim bullets 1.00. Investigated nonperfect older-case scores against original base.
- Original four-case baseline: fields 0.833; extraction precision/recall 0.750; verbatim 1.00.
- Detailed final rerun: fields 0.867; extraction precision/recall 0.800; verbatim 1.00;
  zero task/evaluator errors. On the four shared cases, these match baseline aggregates.
- Remaining mismatches concern full-sentence versus labelled subspan extraction, one title
  including the employer, and a location period; they are outside this missing-company fix.
  The initial extra field mismatch varied on rerun; do not claim deterministic model quality.
- Detailed synthetic report retained locally under evals/job_posting_parse-20261017T132150Z-a404728eb480493896dc7d8a5fb0dfeb.md.
- Residual limitations: four preexisting full-AI-lint violations in untouched conversation
  logging files; DB-marked Python tests not run; no browser QA or deployment. Migration
  ordering and safe rollback requirements remain as described above.
