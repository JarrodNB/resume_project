# Study questions

A job's Study tab is one saved collection of individually answered learning questions.
It is separate from career-library interview practice and fictional-role preparation.
`generateStudyGuide(jobId)` generates exactly five questions per successful request;
**Generate 5 more** appends another successful batch to the collection. Nothing is
generated automatically when opening the tab, editing a description, or loading a page.
Old topic-format development guides are unsupported and are not included in this collection.

## Generation and input

The mutation authorizes through the current user's jobs. `StartGuideService` uses the
shared owner lock and locks/reloads the job to validate the request. The durable command
contains only `{job_id}`. SQS carries task/owner/type identity; no job description or
saved question text travels in the execution notification. It does not use career-library
evidence, gaps, or other requirement fields. Blank descriptions cannot start a batch.
One recent queued request per job prevents overlapping generation. Existing AI allowances apply.

At execution Python binds the durable task ID, owner, type, Job subject and command job ID
before reading current sources in one repeatable-read transaction. Finished, foreign,
deleted or older-than-15-minute work stops before provider dispatch. The ordinary read-only
`ai_study_guide_commands` view exposes only current job text and execution identity;
`ai_study_guide_questions` exposes only valid completed question prompts, ordered by task
creation time, task ID and question position. Neither view stores copies or grants access
to arbitrary task results, histories or accounting data.

`QuestionCollection` and the Python reader select only owned, completed question-format
results with five usable questions. Prior prompts come from these saved generated results,
never browser arguments. The generation context accepts at most 200 prior prompts and
40,000 total prior-prompt characters. Enqueueing and execution both enforce these bounds;
execution reads at most 201 prompts and fails rather than silently dropping older prompts.
A final batch may bring the collection above 200 questions; another batch then cannot start.
These limits bound model context, not reading of saved material.

The Python worker validates loaded sources and uses a bounded-text input guard,
contact replacement, tracing, and configured bounded model/fallback execution. Study-guide
generation does not classify prompt injection and requires no screening credentials.
It grants no screening approvals to the source or generated output. The assembled prompt
renders a labeled `job_description` block and numbered `previous_study_questions` block
without dumping JSON.
The versioned instructions request fresh concepts and avoid close paraphrases of earlier questions.

A valid `result.study_guide` version 1 contains a title and exactly five ordered questions.
Each has a question and job relevance (up to 1,000 characters each), a well-explained
answer (up to 6,000 characters), and a hypothetical worked example (up to 3,000 characters).
Questions teach subject knowledge across occupations without inventing candidate experience
or employer facts. An unusable description, or exhausted subject matter that cannot support
another useful batch, can return `StudyGuideUnavailable`; the worker fails the task with
`failure_code=insufficient_description` and retains actual model usage.

Rails accepts results under owner/task/job locks. It validates the batch, rejects duplicate
prompts within it, and checks against all current saved prompts for that job. Normalization
uses Unicode NFKC, lowercase, and collapsed non-alphanumeric separators. Thus concurrent completion cannot bypass exact-repeat rejection. Prompt instructions address semantic
repetition; normalization does not claim to detect every close paraphrase. The finished-task
guard ensures duplicate result delivery cannot append twice. Each successful batch remains
on its own AI task, preserving an execution-time SHA256 description fingerprint, usage,
and task outcome receipts. Completed result metadata cannot contain copied source text.

## Reading and freshness

`job.studyQuestionBatches(cursor)` returns one batch (five answered questions), oldest
first by request timestamp then task ID, an `endCursor`, `totalQuestions`, and errors.
Signed cursors bind the exact timestamp, ID, and owned job. The end cursor remains valid
at the end of the collection, allowing a newly completed batch to be read later. A newly
appended batch cannot shift earlier pages. Failed, pending, topic-format and malformed
results are excluded. Ordinary job reads do not fetch generated question bodies.

The reader loads the first batch, then loads subsequent batches only when Next crosses
a loaded boundary. Previous reuses loaded batches. One index and total cover the whole
collection; a completed generation updates the total without resetting the current question
or revealed answer, including when earlier batches have not yet been loaded. A failed
page retains the current question and retries the same cursor on Next. Switching jobs
resets collection state, question position, answer visibility, and outstanding UI work.

Each batch exposes its execution-time description fingerprint. The worker hashes the exact
loaded description; it does not return the source text. Existing completed legacy guides
derive the same fingerprint from their retained old input. Legacy queued task copies are
ignored by the new reader; an already-running older worker may finish its output without
a fingerprint using its retained legacy source. No completed or expired work is replayed.
Deploy the new reader views/grants before the worker and deploy the worker before the
reference-only study producer. A current-description
fingerprint lets the reader refresh freshness for every loaded question after one small
read, including batches not on the first page. Freshness compares exact case and whitespace.
The selected question's notice reflects its own batch, so new questions do not make old
material appear current. Restoring the exact original description restores matching
questions to current status; clearing it keeps saved material readable and disables generation.
Overlapping description changes or generation completion queue a final metadata read,
preventing an older Apollo-deduplicated response from becoming the final freshness state.

## Recovery and deletion

The collection follows task subscriptions instead of polling. Pending and failed work keeps
saved questions readable. `studyGuideRetryAfterSeconds` supplies the remaining server wait;
a one-shot timer reveals manual retry but never starts AI work. A new explicit request can
retire queued tasks older than the shared `IN_FLIGHT_WINDOW` (currently 15 minutes), after
allowance and source/context validation. Late output cannot revive a retired task, while
late per-attempt usage is still counted once.

Job deletion uses the owner/job lock order, nullifies task subjects, and retains usage.
Late completions fail; direct task reads and subscriptions hide deleted jobs' source and
results. Terminal task outcomes use the shared notification feed and link to the owned
job's Study tab, falling back to the jobs list when the job is unavailable.

## Verification

Offline checks use worker dispatch, Rails result application and GraphQL collection reads,
and the rendered React panel. They cover current-source reads, owned prior prompts, repeat rejection, limits,
source limits, signed cursor scoping and equal-time ordering, page failures, appending
behind unloaded pages, answer visibility, freshness edits/restoration, and manual retry.
`python -m evals.run_study_guide_evals` uses seven synthetic cases: inventory, backend
engineering, sparse bakery work, irrelevant input, injected instructions, a fresh appended
batch, and exhausted subject matter with earlier saved questions. Prior prompts pass through
the production worker and are shown to the judge as readable context; evaluation-only labels
never enter generation. The judge checks repeated learning concepts as well as wording. Deterministic
outcomes require generated learning material for usable descriptions, including the injected
source case, and an explicit insufficient-description result for unusable sources. A subject-quality
judge assesses relevance, accuracy, answer depth, and worked examples. Finite evaluations
do not prove universal correctness or semantic duplicate detection.

For human QA, generate a batch, reveal an answer, and request five more. Confirm the answer
and current position remain, then navigate across the batch boundary and reload. Load a
later batch, edit/restore the description, and confirm that question's freshness without
losing position. Check blank descriptions, pending/failed batches, manual retries, keyboard
focus, narrow layouts, and both themes. No grading, answer persistence, or progress tracking
is provided.

## Optional answer diagrams

Each question may include `diagram`, or leave it null. A diagram is a small relationship map,
not model-authored markup: a caption (up to 200 characters), a prose `explanation` (up to 1,000),
2–6 nodes with unique lowercase identifiers and labels, and 1–8 directed edges. Node and edge
labels are bounded to 160 characters. Every edge references two different declared nodes;
every node participates, and repeated directed connections are rejected. The Python schema and
Rails result acceptance validate these constraints before a batch is saved.

The reader renders each connection as a source concept, labeled arrow, and destination concept.
Connections stack vertically on narrow screens; labels wrap and use the existing theme tokens.
The caption and prose equivalent remain readable without the visual map. The visual map is
hidden from assistive technology to avoid repeating the equivalent prose. React escapes all
labels as text; diagrams cannot supply HTML, SVG, links, styling, or executable diagram syntax.
A malformed optional diagram in a saved result is omitted by the defensive parser while its
question, answer, and example remain readable. Diagram absence is normal. Diagrams appear only
inside revealed answers, and generation instructions require them to add teaching value.

The study-guide quality judge receives readable caption, explanation, concepts and relationships,
with no JSON dump. It assesses correctness, teaching usefulness and the text equivalent, while
accepting answers that do not benefit from diagrams. Non-browser tests cover diagram reveal,
malformed fallback and escaped long labels; actual narrow-layout and light/dark visual QA remain
human checks.
