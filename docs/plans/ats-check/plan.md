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
- Planning commit / integration base/head: not created.
- Intended integration branch: `work/ats-check`; no implementation branches created.
- Tickets: 01 content checking; 02 content report UI (blocked by 01); 03 PDF inspection
  (blocked by 01); 04 export and complete report (blocked by 02 and 03). All ready-for-agent
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
