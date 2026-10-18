# Interview prep

Persistence, concurrency, and coaching rules for interview practice. Queue payloads are defined in [AI tasks](ai-tasks.md#queue-messages).

[Architecture overview](../architecture.md) · [AI tasks](ai-tasks.md) · [Interview prep](interview-prep.md) · [AI safety and usage](ai-safety-and-usage.md) · [Career library](career-library.md)

## Interview Prep

Rails owns `interview_question_sets` and `interview_questions`; the Python worker returns
drafts without writing domain data. Sets belong to a user and have a unique per-user number
and immutable `set_type` (`general`, `technical`, or `knowledge`, defaulting to general for legacy data).
Allocation runs under the user lock and considers retained generation task inputs, so deleting
a set does not reuse its number. Sets can be empty while generation is pending or failed.
Successful generation validates all drafts and creates positions 1–5 atomically. Only question
text is persisted on the slots; categories and evidence remain in the AI task result.

Questions store the user-written `answer_text`, `question_revision`, `answer_revision`, latest
feedback JSON, and the question/answer revisions that feedback reviewed. Explicit saves allow
an empty answer and increment the answer revision only when text changes. The answer limit is
10,000 characters, defined in Rails `config/initializers/text_limits.rb`, Python `text_limits.py`,
and web `src/lib/textLimits.ts`. Answers never become career-library entries. Deleting a set
cascades its questions and nullifies AI task subjects, retaining usage records and task inputs.

`InterviewPrep` services own generation, saving, replacement, feedback, and deletion. GraphQL
exposes owned `interviewQuestionSets` / `interviewQuestionSet(id)` queries and the mutations
`generateInterviewQuestionSet(input: {setType: GENERAL | TECHNICAL | KNOWLEDGE})`, `saveInterviewAnswer`, `regenerateInterviewQuestion`,
`requestInterviewAnswerFeedback`, and `deleteInterviewQuestionSet`. Question mutations scope
`questionId` through the owned `questionSetId`. AI work uses the shared usage allowance checks.
Feedback requires a nonblank answer and saves it before allowance checks or queue publication;
screening, budget, or queue failure therefore preserves a valid submitted answer.

Enqueue preparation, answer saving, deletion, and result application serialize on the owner
lock. Result application takes the owner lock before the task lock. Only one queued replacement
or feedback operation may run per question; replacement blocks answer saving, while pending
feedback permits edits. Replacing an answered question requires `confirmed: true`.

Result services check ownership, subject/set/question identity, latest task identity, and
snapshot revisions before writing. Replacement requires unchanged question and answer
revisions and checks distinctness against the current set, including the old question. On
success it increments both revisions and clears only that slot's answer and feedback; on
failure it preserves the old content. Feedback requires an unchanged question and the latest
feedback task, but accepts a newer answer revision: coaching is stored against the reviewed
revisions, so GraphQL `feedbackOutdated` marks substantive edits outdated. Capitalization and
whitespace changes remain current when a completed task's matching feedback and reviewed
answer snapshot verify that only formatting changed. Exact revisions still advance on saves.
Generated feedback never writes
the answer. Deleted, superseded, or invalid targets fail cleanly. The finished-task guard
prevents duplicate result persistence and usage accounting; failed application still retains
reported usage once.

Question generation requires usable library content; feedback can use an empty library. Both
handlers screen saved library-fact responses and omit job-derived requirement fields from
prompts and grounding evidence. Feedback also screens the submitted answer and fails closed
on rejection or screening unavailability. Existing contact masking, prompt limits, bounded
Pydantic AI runs, versioned prompts, and Logfire tracing apply. Question evidence requires
exact library excerpts; optional feedback excerpts are normalized to exact source text and
invalid excerpts discarded. Feedback validates nonblank prose and at most two placeholders;
personal-fact grounding and knowledge correctness still
requires quality evaluations. Run both interview eval runners after prompt/model/agent changes
(commands in `services/ai/evals/AGENTS.md`); finite, stochastic passes are not a universal
grounding guarantee.

Knowledge sets test understanding of subjects explicitly relevant to the career library in
every occupation, including sparse skills-only backgrounds. Five categories cover concepts,
mechanisms, application, reasoning, and limitations. Clearly hypothetical examples can test
application without asserting personal experience. Replacements retain this subject scope
and exclude the intents of all five existing questions. The library selects topics rather
than serving as an answer key. Knowledge coaching identifies factual errors, omissions and
reasoning gaps, then provides a concise corrected illustrative subject answer using model
knowledge. It must never invent personal experience. General and technical feedback continue
to use only supplied personal facts, with placeholders where needed. Synthetic evals include
nontechnology topics and incorrect answers, with a dedicated knowledge-accuracy judge and
scope-aware grounding rubric. There is no external knowledge ingestion, grading, code
execution, saved-job targeting, or answer-to-library persistence.
Trusted per-run scope selects separate knowledge-feedback instructions, so knowledge calls
never receive personal-fact-only scaffolding rules. The subject-accuracy judge deterministically
skips other scopes; its aggregate measures knowledge cases only.

The web routes `/interview-prep` and `/interview-prep/:id` list numbered/date sets newest first
and display five ordered cards. Persisted `latestTask` fields restore subscriptions on reload.
Cards preserve local drafts, show outdated feedback for substantive unsaved changes too, warn before
navigation with unsaved answers, and keep replacement controls locked until the new question
revision is fetched. Set deletion is confirmed; feedback/examples remain beside the answer.

## Decisions

- **Interview sets have an immutable general, technical, or knowledge scope.** Existing sets and older
  queue snapshots default to general. Technical practice discusses actual role-specific work,
  methods/tools, decisions/tradeoffs, problem solving, and improvement/quality for every
  occupation, rather than knowledge quizzes, coding or hypothetical design exercises.
  Sparse skills, education, and nontechnology backgrounds receive best-effort questions
  grounded in available library evidence; only the existing empty/unusable-library check
  blocks generation. Generation, replacement, and feedback snapshot the type, and result
  application rejects mismatched snapshots. Feedback remains illustrative coaching and
  never replaces the saved answer. Knowledge practice tests career-relevant subject matter
  in all occupations; library excerpts select topics while model subject knowledge supplies
  corrections. Keeping personal-fact grounding distinct from subject correctness lets the
  coach correct wrong answers without fictional experience. No type targets a saved job.

- **Interview practice is persistent and independent of the library.** Existing questions
  stay fixed when career details change; new generation uses the current library. Multiple
  numbered/date sets support repeated practice without custom names or archived question
  history. Each set has five distinct English questions within its selected scope;
  job-specific generation remains future work.

- **Interview feedback coaches the user's answer.** It never fills or replaces the answer
  field and uses placeholders for missing personal facts in general/technical examples.
  Knowledge examples can correct subject facts without placeholders. Excluding job-derived requirements avoids
  treating an employer's expectations as the user's experience. Revision-bound feedback
  allows editing during AI work while making delayed coaching visibly outdated.

- **Feedback freshness ignores capitalization and whitespace.** Revision changes still track
  exact saved edits, but harmless formatting should not force another AI review. Completed
  task snapshots verify saved-answer equivalence; missing or mismatched evidence stays outdated.

- **One successful feedback request per saved version.** Feedback enqueueing checks completed
  task history for the question/answer revision pair under the owner lock. Queued requests
  already prevent overlapping operations; failures can be retried. Saving changed text or
  replacing a question creates a new version. The web button uses persisted feedback revisions
  to remain disabled after success and reload.

- **Interview replacement preserves content until success.** Task identity, revisions, and
  owner-before-task locking prevent obsolete or concurrent results from overwriting newer
  work. Atomic five-slot creation and single-slot replacement avoid partially populated sets
  or clearing unrelated answers. Confirmation protects an answered slot from accidental loss.

- **Interview Q&A vectors remain separate from career-library evidence.** Future successful
  nonblank answer saves (including unchanged saves and feedback saves) enqueue a question-specific
  `InterviewPrep::SyncQuestionEmbeddingJob` after commit. `interview_question_embeddings` stores
  original combined Q&A, a model/masked-text digest, source revisions, and a 1536-dimension vector.
  Contact is masked only for the provider. A unique question foreign key cascades deletion;
  edits/clears and successful replacements invalidate vectors in the source transaction.
  The service snapshots and rechecks ownership, content, and revisions under the owner lock,
  releasing it during HTTP. A question advisory lock serializes duplicate jobs. Late results
  cannot restore obsolete content. There is no backfill, search index/interface, library
  promotion, or AI-reader grant. Temporary errors retry; missing configuration logs and skips.
  These independent Rails calls incur provider costs outside AI-task budgets/attempt reports
  and Logfire tracing, like library syncs; feedback tasks do not absorb their costs.

## Saved screening inputs

Interview generation reads owner-scoped library entries and screens them on first AI use.
The canonical source units match comparisons and tailoring, so unchanged entries can reuse
successful checks after Rails persists their reports. Fact responses exclude job-derived
requirements from both checks and interview prompts.

`StartQuestionTaskService` adds `saved_input_snapshot: "interview_question_v1"` after saving
and snapshotting question/answer revisions. This server-only provenance marker makes the
exact question, answer, and excluded-question bytes eligible for reuse; it grants no approval.
Older unmarked snapshots still work and screen those strings within each execution. Saves
and feedback/replacement result revision checks retain their existing behavior. A late
screening report approves only its exact protected bytes and policy, never a newer revision.

Persistence is asynchronous: retries or simultaneous tasks before the report is applied can
repeat classifier calls. Rejected or unavailable checks are never remembered. Text edits,
privacy-protected content changes, and screening-policy changes require new checks. Deploy
the screening store migration and reader grant before updated workers; no backfill is needed.
For manual QA, generate a set, wait for result persistence, replace a question, then request
feedback on a saved answer. Unchanged sources should add no classifier requests; editing an
answer should check that new answer while preserving saved text even if feedback fails.
