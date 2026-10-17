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
