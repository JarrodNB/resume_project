# Study guides

Study guides turn a saved job description into readable learning material. They are separate
from career-library interview practice and fictional-role interview preparation.

`generateStudyGuide(jobId)` authorizes through the current user's jobs and queues
`generate_study_guide`. Enqueueing serializes on the owner and locks/reloads the job before
capturing `{job_id, description}`. The Python worker uses that exact description; it never
loads the career library, gaps, or separate job requirement fields. An empty description
cannot start generation. One recently queued generation per job prevents overlapping requests.

Manual recovery uses the same `IN_FLIGHT_WINDOW` as shared allowance checks (currently
15 minutes from task creation). A queued task older than that window no longer prevents
a retry. Only an explicit new request retires expired queued tasks as failed, under the
owner/job locks, after allowance and description validation. It preserves source snapshots,
earlier guides, and usage; state changes are broadcast after the enqueue transaction. Late
output cannot revive a retired task, while late per-attempt usage is still counted once.
Recent queued work remains protected, and retry requests still consume normal allowances.

`studyGuideRetryAfterSeconds` supplies server-calculated remaining time for queued guides.
The reader uses a one-shot timer to offer manual retry if it stays open, and recognizes
already-expired work after reload. It keeps the subscription and old material readable;
the timer never polls, starts generation, or changes persisted task state. The server
rechecks eligibility when the user clicks retry. This also recovers lost emulator queue
messages after a restart without leaving a saved job permanently blocked.

The worker screens the frozen description afresh. Existing saved-job approvals cover other
fields and are not reused. Unavailable screening and rejected input both fail closed, with
distinct diagnostics. The versioned Pydantic AI agent uses the official input guard, contact
masking, tracing, bounded run limits, and configured model/fallback policy. It returns
`result.study_guide` with a title and 1–8 ordered topics. Each topic contains a title,
`why_it_matters`, an explanation, 1–5 exercises, and 1–5 self-check questions. The model
teaches relevant subject knowledge without inventing candidate experience or employer facts.
Irrelevant source text receives a brief request for a meaningful description, not an invented role.

Rails validates the result shape and existing owned job under owner/task/job locks before
accepting completion. Each successful output remains on its own AI task. The newest attempt
and newest successful guide are separate fields (`latestStudyGuideTask` and
`latestStudyGuide`) so pending/failed work leaves saved material readable. Finished-task
and attempt-accounting guards retain the shared duplicate-delivery behavior.

Job deletion takes the same owner/job locking order, nullifies task subjects, and retains
usage records. Late completions fail. Direct task reads and subscriptions hide a deleted
job's guide result and source snapshot; historical usage remains available.

The job page's Study guides section starts collapsed and remembers disclosure per job.
It loads guide bodies only when opened, follows task subscriptions instead of polling,
and shows generation errors beside retained successful material. It offers readable
exercises and questions without answer persistence, grading, or progress tracking.

`job.studyGuides(cursor)` returns five successful guide summaries at a time, newest first
by request time and then task ID. The summaries contain IDs, generation dates, and source
fingerprints/freshness, without generated bodies or source descriptions;
`job.studyGuide(id)` loads selected content and requires that successful guide to belong
to the same owned job. Signed cursors bind the job and the last row's exact timestamp/ID,
so adding newer guides does not shift later pages. Failed and pending attempts never
become successful history entries.

The reader initially selects the newest guide. History buttons show local dates and times,
including seconds, and older pages load on request. A new completion refreshes history once
without discarding a selected older guide or already loaded entries. Page failures preserve
readable material and allow retrying the same continuation. Switching jobs resets the
history, selected guide, and in-flight UI state; reopening a section starts with the newest
guide again. Long learning material uses the workspace's readable prose measure.

Each guide's freshness compares the exact enqueue snapshot with the current description,
including case and whitespace. `studyGuideOutOfDate` reports selected-task freshness;
history entries expose `outOfDate` and an immutable `sourceDescriptionFingerprint`. Job's
`studyGuideDescriptionFingerprint` identifies its current text. These SHA-256 fingerprints
let the reader update every loaded history entry after one small refresh, including older
pages, without sending source text or loading guide bodies again. A description cleared
to blank makes valid earlier guides stale and prevents another generation request.

Saved description edits refresh freshness, not generation. Overlapping edits and generation
completions queue a final read after an in-flight refresh, avoiding stale Apollo-deduplicated
responses. Reopening the section also checks the server. Old material stays readable;
description changes during generation can produce an immediately out-of-date completed
guide. Restoring exactly the original description makes matching guides current again.
Manual regeneration appends a new guide from the description captured for that request.

For human QA, load more than one history page and select an older guide; edit and restore
the description while keeping the section open. Check the reader and all loaded history
notices without losing the selected material or starting AI work. Generate again, edit
while it runs, then check that the finished guide reflects its original request and is
marked out of date. Clear the description and verify older guides remain readable while
generation is disabled; reload to verify saved history and freshness.

Quality checks: `python -m evals.run_study_guide_evals` uses five synthetic descriptions
covering inventory, backend engineering, a sparse bakery role, irrelevant text, and an
injected instruction. Deterministic checks verify outcomes; a separate judge assesses
relevance, subject accuracy, and useful exercises. Screening outages fail evaluation rather
than counting as attack rejection. Offline contracts live in handler and evaluator tests;
finite model evaluations do not prove universal subject correctness.
