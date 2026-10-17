# ATS check

## Problem Statement

Users can tailor, edit and preview resumes without feedback on job alignment or the
readability of the exported file. Provide actionable checks without rewriting resumes
or inventing career facts.

## Human Decisions

Confirmed in this chat on 2026-10-17:

- Check job alignment, content quality/structure, and actual PDF extraction/reading order.
- Show prioritized findings, explanations, suggested fixes and 0–100 category scores.
  Explain the rubric and deductions. This is a Careergrind assessment, not an employer's
  ATS score or a prediction of selection.
- Automatically check content after the first save and subsequent changed saves. Allow
  manual reruns; avoid duplicate automatic checks for unchanged content.
- Mark earlier results outdated after edits, including unsaved edits in the open editor.
- Generate/upload a PDF for checking only on export. Editing or saving never triggers
  PDF generation/upload for ATS. Existing local preview remains available.
- Show an overall score only after all applicable checks complete, including the PDF.
- Check failures do not undo saves. Offer retry. If the job is unavailable, omit alignment
  explicitly. Suggestions never invent qualifications or experience.

These are confirmed requirements, not approval of this written plan. Detailed design
and scoring rules below are proposals for plan approval.

## User Stories

- After saving, I can see job coverage and writing/structure problems with specific fixes.
- On export, I receive my PDF and can follow its asynchronous readability check.
- After editing, I can distinguish old feedback from feedback on the current version.
- I can retry failed checks without losing my resume or other successful category results.

## Solution

Add an ATS report section to the saved resume editor, following the existing collapsible
section convention. Show queued, running, completed, failed, outdated and awaiting-export
states. Each finding includes category, severity, affected section/requirement, observed
evidence, explanation and suggested action. Do not automatically apply suggestions.

Changed saves start content checks after persistence. Manual rerun targets saved content.
When unsaved edits exist, require an explicit normal save before rerun or export; do not
silently save. Keep earlier feedback visible with its date and outdated label, excluding
its scores from the current total. No report-history browsing feature is needed.

The inspected code has PDF preview but no download action. Add Export PDF using the same
document component. Generate one file, initiate its download and upload those exact bytes
for queued inspection. Download does not wait for checking and still works if upload/check
fails. Preview never queues ATS work. Retry PDF checking through export again.

### Proposed scoring rubric

Version the rubric and expose rules/deductions in the UI. Deterministic code calculates
scores from validated assessments; the model does not invent an overall number.

- **Job alignment:** each explicit requirement is covered/partial/missing, earning 1/0.5/0
  of its weight. Required requirements weigh 2; preferred weigh 1. Round the earned
  fraction times 100. Cite supporting resume text and explain terminology gaps without
  rewarding repetition. No usable requirements means unavailable with an explanation.
- **Content quality:** ten equally weighted checks: contact usability; clear section labels;
  role/employer identification; usable consistent dates; understandable experience;
  specific evidence for claims; clear concise writing; relevant organization; repetition;
  and unfinished placeholders/contradictions. Pass/partial/fail earns 1/0.5/0 of the weight.
  Normalize over applicable checks. Do not penalize absent optional sections or lack of
  numerical achievements alone. Qualitative judgments require supporting excerpts.
- **PDF readability:** five equally weighted checks: extractable text; expected content
  coverage; logical reading order; preserved characters/words; and recoverable section/entry
  boundaries. Pass/partial/fail earns 1/0.5/0 of the weight. Compare actual extracted text
  and coordinates with the expected export model using documented normalization and
  tolerances. Return page/excerpt evidence. Inability to inspect is failure, never a zero
  or a pass. Verify multi-page output through real generated fixtures.
- **Overall:** rounded equal mean of applicable categories, pending until all complete.
  Failed checks leave it pending; explicitly unavailable categories are excluded with reasons.

## Implementation Decisions

Rails owns a report aggregate linked to the user-owned resume and check tasks. Keep content
and PDF outcomes independent. Persist immutable run snapshots, canonical content and job
fingerprints, rubric version, task references, findings and category results. For PDF runs,
also store the renderer version and byte digest. Retain metadata/results; purge uploaded
check files after processing, including terminal failures. Retry then requires another export.

Fingerprints cover ordered section types, titles, positions and content, excluding timestamps.
Lock the resume when saving/starting runs. Unchanged saves do not schedule automatic checks;
concurrent requests reuse the same in-flight input run. Manual reruns may create a new run.
Tie results to immutable run identity; late results cannot replace newer current outcomes.
Job changes invalidate alignment; deletion makes it unavailable. Rubric/renderer changes
invalidate affected scores. Unsaved edits mark the UI outdated locally.

Add queued task types `check_resume_content` and `check_resume_pdf`. Inputs carry run/report
identifiers and fingerprints. Workers read large snapshots through user-scoped read-only
database access. Only PDF blob keys and metadata cross SQS, never binary data. Return
versioned structured output through `ai_results`; Rails validates and applies it atomically.

Combine deterministic content rules with a Pydantic AI agent for requirement coverage and
qualitative assessment. Validate referenced evidence against the snapshot. Follow existing
screening, contact masking, prompt limits, tracing, transcript and usage accounting rules.
Keep PDF extraction/comparison deterministic and local; do not send the file to a model.

Expose report reads, content rerun, and export upload/start through authorized GraphQL.
Reuse Active Storage upload and byte-detected type/size validation, allowance checks and
task subscriptions. Validate ownership, attachment association and saved version server-side;
client fingerprints are not authoritative. Reject stale submissions with a refresh message.

Persist pending scheduling work after a save and dispatch through a retryable background
job. Scheduling/allowance failure must be visible independently of save success. Do not
retry automatically forever on unchanged saves. Respect existing AI budgets and limits.

## Testing Decisions

Use observable service, GraphQL, queue and component interfaces. Existing examples:
`save_tailored_resume_service_spec.rb`, `update_resume_sections_service_spec.rb`, task
result specs, `test_tailor_resume_handler.py`, `TailorResumePage.test.tsx`, and
`resumePdfModel.test.ts`. Synthetic fixtures only.

- Rails: first/changed/unchanged saves, dispatch/allowance failures, concurrent requests,
  manual retries, job changes/deletion, authorization, upload ownership/type/size, invalid
  results, duplicate/late delivery, atomic persistence and file cleanup.
- AI: evidence validation, missing requirements, masking/screening failures, malformed
  output, deterministic scoring, and usage. Add agent evals for coverage, evidence,
  supported suggestions and assessment consistency.
- PDF: production document generation in a non-browser test, successful extraction,
  missing/reordered text, character loss, corruption and multi-page documents. Document
  comparison tolerances in tests and implementation.
- Web: category/overall states, unsaved/saved freshness, save/rerun, same-blob download and
  upload, upload failure, and absence of ATS PDF work on save or ATS work on preview.
  Fake external boundaries without mocking away business behavior.

## Architecture Decisions

Keep report lifecycle, scoring and applicability in cohesive ATS modules behind small
interfaces. Save services request checks; callers do not manage report transitions.
Rails owns writes; Python owns assessments and file inspection. Shared schemas remain
independent of orchestration. Extend `ai_reader` grants only for required snapshot data.

Update existing architecture guides for queue contracts, freshness, scoring, cleanup and
failure rules during implementation; update glossary terms where useful. These decisions
remain proposed until plan approval.

## Rollout Risks and Other Risks

- Model judgments vary and do not reproduce every ATS. Explain scope and validate evals.
- Frequent changed saves incur costs; deduplicate inputs and retain existing allowances.
- Text extraction tolerances must handle wrapping/whitespace without hiding missing text.
- Concurrent saves/exports/results can mix versions without immutable snapshots and locks.
- PDFs contain personal data: authorize access, inspect locally, purge files and keep only
  necessary evidence under existing account ownership/deletion rules.

## Observable Acceptance Criteria

1. First/changed saves schedule content checks; unchanged saves do not. Check failures
   preserve save success and expose actionable status/retry.
2. Content reports explain requirement coverage, supported findings, suggested actions,
   rubric deductions and scores without automatically changing the resume.
3. Editing/saving never generates/uploads ATS PDFs. Preview queues no ATS work. Export
   downloads and checks the same bytes without waiting for analysis.
4. Actual PDF checks assess extraction, coverage, reading order, characters and boundaries;
   inspection failures are visible and retryable through export.
5. Overall scores wait for all applicable current checks. Missing job context explicitly
   omits alignment. Scoring follows the exposed versioned rubric.
6. Unsaved edits, saved changes, job changes and late results cannot make old scores look
   current. PDF results remain bound to the exact export and saved resume version.
7. Concurrent starts, duplicates, malformed results and cross-user requests preserve report
   correctness, tenant isolation and usage accounting.
8. Uploaded files are validated, version-bound and cleaned up after processing.

## Dependencies and Verification

Follow `docs/testing.md`: focused Docker Rails RSpec and AI pytest; schema dependency test;
Ruff; frontend tests/typecheck/lint; GraphQL schema dump then frontend codegen. Record exact
paths and actual results during implementation. Run appropriate integration suites and
the new paid ATS eval runner, recording charges/limitations truthfully. No browser automation.

Manual QA: tailor/save; inspect findings and rubric; edit without saving; save and observe
fresh content/PDF-pending states; preview without tasks; export and inspect download plus
PDF findings; retry failure; change/delete job; verify old scores remain outdated. Include
long multi-page resumes, contact details and links.

## Out of Scope

Automatic rewriting, feedback-driven regeneration, employer-specific ATS integrations,
selection predictions, third-party scoring services, arbitrary uploaded resume checking,
DOCX export, visual design grading and mass applications.

## Additional Notes

Read nested instructions before implementation edits. Preserve unrelated changes. Keep
the Kanban item until explicit human acceptance.

## Delivery Record

- Source: `KANBAN.md`, “ATS check”: “Tailored Resumes should be passed into a thorough ATS check”.
- Phase/next action: plan and breakdown approved; prepare planning commit and implement 01.
- Requirements confirmed: 2026-10-17, including revised export-only PDF behavior.
- Plan approval: user said “confirmed” on 2026-10-17 in response to the written plan approval
  request. Approved file SHA-256 before delivery-record updates:
  `E76E7C0ED6FECE44A758EFE348F9229C1914F542B11C1E31861CE13E0911471D`.
- Breakdown approval: user said “confirmed” on 2026-10-17 after the four-ticket breakdown;
  approved tickets SHA-256: `73FF1159511AE65FBCFC2865E833CF01B985359E2598A297D4C1D43C248C69DC`.
- Planning commit and integration base: 286247344dda72b3a0608f6279c10b387c229d90. Integration head starts at that commit.
- Intended integration branch: `work/ats-check`; no implementation branches created.
- Tickets: 01 content checking; 02 content report UI (blocked by 01); 03 PDF inspection
  (blocked by 01); 04 export and complete report (blocked by 02 and 03). 01 in-progress; others ready-for-agent
  subject to breakdown approval and dependency integration; implementation not started.
- Checks, blind reviews and PR: not started.
- Exploration: tailoring handler, save/update services, saved editor, PDF model/document/
  preview, Active Storage import and SQS/result contracts inspected. No export action found.
- Environment: checkout reports `master`. WSL execution returned `Wsl/E_ACCESSDENIED`;
  Windows Git status returned `unable to open '.git/sequencer/todo': Function not implemented`.
  File access works. Resolve runtime/Git access before implementation or commits.
- Execution access resolved: approved elevated WSL commands run Linux Git and Docker;
  Linux Git status is clean. Planning files are ignored by `/docs/plans/` and will be
  explicitly added for the workflow-required planning commit.
- Verification: planning-only files; no application checks run. Ticket approval remains
  required before implementation under the requested workflow.

### Ticket 01 integration

- Worker c19e79f integrated as 836c612; immutable inputs, content checks, report subscription,
  after-commit dispatch/recovery, evidence validation and scoring implemented.
- Root verification on integration: 59 Rails examples passed (ATS, resume tailoring,
  AI results, schema dump); 23 ATS/schema AI tests passed. Worker broader focused checks:
  74 Rails, 41 AI passed; Ruby/Python lint clean; schema and types generated.
- Paid synthetic evaluation: 3 cases; requirement assertions 100%; supported suggestions
  1.00 each. Reported cost about USD 0.01822; earlier exploratory costs not fully recorded.
- Tickets 02 and 03 started from 836c612 in isolated worktrees /home/jarrod/ats-check-02
  and /home/jarrod/ats-check-03. Ticket 04 remains dependent on both.
- Pending dispatch recovery command is documented; full suites and blind reviews remain.

### Focused PR history

Integration history replayed onto origin/master (4cbf898) to exclude pre-existing unrelated
planning commit e47b178; original checkout and worker branches remain intact. Planning
commit is now b434666; content integration is now 7e55346. This changes history only, not
application code. Worker 02/03 bases remain the already verified 836c612 code snapshot.

### Tickets 02–04 integration and broader verification

- 02 worker803c13f integrated93787fb; root7 focused editor/report tests passed.
- 03 workerbd423a6 integratedb98fce1; root25 Rails and33 AI/schema tests passed.
- 04 export worker5f863bb integratedde6c5cf; production fixture workeraa268f6 integrated533a41f.
- Real renderer tests2 passed and actual generated PDF inspector tests12 passed (including
  existing corrupt/loss/order cases). Red found merged name/email and repeated-year false
  order deduction; preserved separator and forward-first matching made both exports green.
- Broader tests at533a41f: full Rails450 examples passed; offline AI540 passed,2 production
  fixture cases skipped in ordinary run,9 database tests deselected; full web159 passed.
  Production fixture cases were separately executed and passed. One unconfigured Logfire
  warning in offline tests; no real model requests in pytest.
- Final04 reliability work in isolated branches: bind legacy exports to the fingerprint
  captured alongside rendered sections; prevent same-run older payloads downgrading reports.
- Full blind reviews and human manual QA remain pending.

### Final candidate and acceptance audit

- Candidate: 7e3bb7e017b38deb4cdbde37d3fbbe0bc0d7a831.
- Review base: 4cbf898d2f992f1b468bc96df1675d0414572d24.
- Final full Rails suite: 454 passed. Final full web suite: 166 passed. Typecheck,
  frontend lint, schema dump and client code generation passed.
- Final reliability commits: ae675e9 captured export identity; 0ae9ac4 malformed PDF
  keys; 7e3bb7e report revision/observation ordering.
- Coordinator acceptance audit: criteria 1-2 covered by save/result/GraphQL and report
  tests; 3-4 by 11 export tests plus actual production renderer/inspector tests and
  corrupt/loss/order fixtures; 5 by deterministic scoring/job-deletion tests; 6 by
  cross-tab identity and 4 response-ordering tests; 7-8 by ownership, duplicate, late
  and malformed results, allowance and cleanup specs. No browser/manual QA performed.
- All four tickets integrated and verified. Fresh blind correctness/design reviewers
  started on identical fixed snapshots without planning context. Results pending.
- User acceptance remains pending and the Kanban item remains on the board.

### Blind review round 1

- Both reviewed base 4cbf898d2f992f1b468bc96df1675d0414572d24 to head
  7e3bb7e017b38deb4cdbde37d3fbbe0bc0d7a831 with no planning context.
- Correctness: P2 scheduling failure renders queued and disables manual retry; P2
  concurrent saves can pair submitted draft A with fingerprint B resolved after A unlocks.
  Both accepted for regression-driven repair in work/ats-check-review-fixes.
- Design: no actionable code design issues; P3 hardcoded worktree in production PDF
  verification commands accepted and corrected to checkout-relative host mounts.
- Correctness checks: 18 offline AI passed, 2 production cases skipped without fixtures;
  22 web passed. Design checks: 18 AI, 22 web, 2 actual renderer and 2 actual PDF checks passed.
- Neither reviewer ran Rails DB tests or paid evaluations. Review changes require a fresh
  pair against the revised full code diff before the PR handoff.
