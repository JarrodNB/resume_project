# Saved resume ATS assessments

Careergrind checks saved content after the first save and every changed save. This is
our rubric, not an employer score or a selection prediction. Saving never generates,
uploads, or inspects a PDF. PDF inspection starts separately on export.

## Ownership and identity

Rails owns `ats_check_runs`, immutable ordered section snapshots (id, section_type,
title, position, content), job requirement snapshots, SHA-256 fingerprints, rubric
version, scheduling state, task references and category results. Canonical fingerprints
sort JSON object keys and retain array order; timestamps do not affect identity.
Requirements and responsibilities have required weight 2; nice-to-haves have weight 1.
Blank or non-string requirements are omitted; each remaining requirement has a stable
group/index id, text and required flag.

The save transaction persists pending work under the resume lock. Dispatch runs after
commit and acquires the user lock before the run lock. Allowance failures fail only the
check. Queue publication retries the same task, up to five attempts, without another
allowance charge/task row. If a process exits before enqueueing the job, or enqueueing
fails, pending rows remain recoverable with `bin/rails ats_checks:recover_pending`.
Operations should run that recovery task periodically with the existing job scheduler.
Manual retry re-enqueues a pending run and replaces terminal runs. Unchanged ordinary
saves do not retry failed checks forever.

Result application uses owner, task, then run locks and existing attempt accounting.
Duplicate terminal results cannot change outcomes; independently identified late usage
is retained once. Old runs can finish and keep their historical results, but report reads
select the newest run. Resume deletion removes snapshots; associated AI tasks remain
for usage accounting. Account deletion removes owned reports through existing ownership.

## Queue contract

`check_resume_content` task input is:

```json
{"run_id":"uuid","resume_id":"uuid","content_fingerprint":"sha256","job_fingerprint":"sha256","rubric_version":"ats-v1"}
```

Large inputs are not sent through SQS. The worker reads `ats_check_runs` using both run
id and user id through its read-only connection. The explicit reader grant adds only this
table. Workers never update domain data.

A successful result repeats run_id and all fingerprints/version, and contains
`requirements` and `checks`. Each requirement includes requirement_id and status
covered/partial/missing. Each check includes key and status pass/partial/fail/unavailable.
Both contain evidence [{section_id, excerpt}], explanation, suggested_action and severity
(info/warning/error). Optional absence_reason describes a verified missing field.
Evidence excerpts must occur verbatim in the referenced section's title or content;
ids and type metadata are not evidence. All requirements and ten check keys appear
exactly once. Invalid shapes, identity, duplicate keys or invented excerpts fail the task
atomically without publishing scores. Suggestions describe changes the user could make
only if supported by their real experience; they never apply edits automatically.

## Scoring and freshness

Rails computes rubric `ats-v1` deterministically. Requirement covered/partial/missing
earns 1/0.5/0 times its weight. Content pass/partial/fail earns 1/0.5/0, equally weighted
over applicable checks: contact_usability, section_labels, role_employer, dates,
experience_clarity, claim_evidence, concise_writing, organization, repetition, placeholders.
Missing optional sections and nonnumeric achievements alone are not failures. Report
assessments retain evidence and prioritized suggestions. Deductions are percentage
points per key (two decimals); category totals round once to integers.

`Resume.atsReport` and `rerunResumeAtsCheck(resumeId)` expose owned reports. Each
category has status, nullable score/reason, assessments JSON and deductions JSON;
the report has runId, fingerprints, rubricVersion, createdAt, outdated, aiTask and
nullable overallScore. Clients subscribe to `atsReportUpdated(resumeId)`, which authorizes through the owned
resume and returns the current report on subscribe/update. Notifications follow committed
dispatch, allowance failure and result transitions, including the period before an AI task
exists. Existing `aiTaskUpdated` remains available for task accounting. A pending background scheduling row displays queued state
even before it has an AI task, with a visible scheduling error when enqueue fails.

Saved content changes invalidate all categories; job changes invalidate alignment only.
Job deletion or no usable requirements makes alignment explicitly unavailable.
The PDF slot initially says awaiting_export. Overall remains null until every applicable
category has completed with a current score; failed/outdated/awaiting-export checks
cannot count as completed. The overall is the rounded equal mean of applicable scores.
The UI additionally marks unsaved edits outdated locally. PDF run metadata/results extend
the independent pdf_result slot without changing content task identity.

AI quality evaluation: `python -m evals.run_ats_content_evals` runs three synthetic
cases through the production masked/screened handler. Requirement coverage is compared
with hand labels; a source-aware model judge checks that suggestions invent no career facts.
Evidence and ten-key completeness are enforced by the production validator; Rails specs
verify weighted scoring and duplicate-result consistency.

## Exported PDF lifecycle

`submitResumeAtsPdf(input: {resumeId, runId, contentFingerprint, rendererVersion, file})`
accepts a multipart Upload for the currently owned, saved run. The renderer is
`resume-pdf-v1`; unsupported renderers and stale saved fingerprints require refresh.
Both declared length and actual bytes are capped at 5 MB, and MIME detection ignores
client filenames. The upload is attached directly to its owned `check_resume_pdf` task;
clients cannot select an arbitrary existing blob. SHA-256 binds the exact exported bytes.
Identical queued exports reuse the current task under owner/resume/run locks. A new
export replaces only the independent PDF slot. Existing allowance checks run before
storing bytes or creating a new task.

The queue carries run/resume IDs, saved content fingerprint, rubric/renderer versions,
digest and source-file key/type. It never carries expected resume text or extracted PDF
text. The worker reads saved sections and current PDF metadata from `ats_check_runs`
with both owner and run IDs, checks task identity, downloads the attached export and
verifies its SHA-256. Expected visible content is derived locally from the immutable
server snapshot, mirroring `buildResumePdfModel` for the pinned renderer. No PDF bytes,
extracted text or PDF findings are sent to any model, including later content checks.

The local inspector uses pypdf text and transformed text-fragment coordinates, bounded
by existing PDF page/text caps. It reports five ratios: usable extraction (1 for a usable
text layer); expected word multiset coverage; saved chunk order and physical backward
reading jumps; normalized character multiset coverage; and complete recoverable visible
chunks (section titles, entry fields and body paragraphs). Case, Unicode compatibility
ligatures, punctuation, ordinary whitespace and line-end hyphen wrapping are normalized.
Word boundaries and repeated-word counts remain significant. Coordinates identify page,
x/y and excerpt; missing saved text is named in `absence_reason` with nearby page evidence.
Physical upward jumps greater than 1.5 times the adjacent font size reduce reading order.
Each ratio is pass at >=0.98, partial at >=0.90, otherwise fail. Rails awards 1/0.5/0 of
each equally weighted 20-point check and computes the integer category total. Ratios stay
visible for explanation; they do not silently change the approved pass/partial/fail rubric.
Corruption, encryption, missing text and resource caps fail visibly without publishing a
zero or completed score. Results repeat every identity field and must include all five
unique checks; malformed output fails only PDF inspection. Late/duplicate tasks cannot
replace another export or change terminal outcomes.

Terminal processing purges the task upload while retaining digest, renderer, metadata,
findings and deductions. Start failures also purge uploads. A delayed cleanup job expires
abandoned PDF tasks after 24 hours; operations should periodically run
`bin/rails ats_checks:cleanup_pdfs` as recovery when scheduling/process failures prevent
that job from being created. Cleanup is idempotent. Retrying after cleanup requires a
new export. Editing/saving/preview never creates a PDF task.

## Delivery ordering

Report consumers compare run creation time (ISO 8601 with six fractional digits), then
run id for equal creation times, matching server selection. Within a run, stateVersion
is the persisted Rails optimistic lock_version serialized as a decimal string. Compare
it numerically; each normal report update advances it even if timestamps are identical.
At equal stateVersion, observedAt orders observations of live resume/job freshness.
It is captured before report assembly and serialized with six fractional digits.
This permits a later job edit to invalidate alignment without requiring a report write,
while delayed queued responses cannot replace a completed persisted revision.
Queries, subscriptions, reruns and PDF submissions all use the same winner rule.

Exporters capture Resume.atsContentFingerprint alongside the section data used to render
and retain it until explicit saving replaces the editor baseline. Legacy resumes without
reports must also match that captured identity before upload; creating a new run cannot
relabel an older tab's content as the current saved version.

## Structured contact privacy

ATS preparation runs local detection on each natural title/content/requirement text value,
not on serialized JSON. A single in-memory privacy session retains discoveries from every
field plus known profile contact. Values are masked before JSON serialization; section and
requirement ids, schema keys, fingerprints, versions and PDF metadata remain outside detection.
The task retains that same session through screening, generation and trace completion.
Repeated masking of a complete ATS JSON snapshot uses the same value-only policy, so a
detected contact matching a key or identity string cannot alter the input contract.
The generic resume import path still prepares its single extracted document as before.
