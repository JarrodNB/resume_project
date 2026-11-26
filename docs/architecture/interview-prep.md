# Interview prep

Persistence, concurrency, and coaching rules for interview practice. Queue payloads are defined in [AI tasks](ai-tasks.md#queue-messages).

[Architecture overview](../architecture.md) · [AI tasks](ai-tasks.md) · [Interview prep](interview-prep.md) · [AI safety and usage](ai-safety-and-usage.md) · [Career library](career-library.md)

## Interview Prep

Rails owns `interview_question_sets` and `interview_questions`; the Python worker returns
drafts without writing domain data. Sets belong to a user and have a unique per-user number
and immutable `set_type` (`fit_motivation`, `behavioral`, `hypothetical`, `technical`, or `knowledge`; default `fit_motivation`).
Allocation runs under the user lock and considers retained generation task inputs, so deleting
a set does not reuse its number. Sets can be empty while generation is pending or failed.
Successful generation validates all drafts and creates positions 1–5 atomically. Only question
text is persisted on the slots; categories and evidence remain in the AI task result.

Python reads up to 20 saved question texts from the user's most recent
sets of the requested type, ordered by set creation time and ID descending, then slot
position and question ID ascending. This bounded history is prompt-only guidance to
prefer fresh focuses. Familiar themes may recur as practice. Historical overlap never adds a rejection or retry.
The history is separate from hard avoidance preferences and replacement exclusions;
it is neither career evidence nor proof of personal facts. Owned active slots supply history, including custom questions, never answers or feedback.
Immutable set origin determines coverage: generated wording remains trusted; manual wording
is screened or reuses its exact recorded approval. Written commands require version 1 and explicit type; copied source commands are unsupported.

Questions store the user-written `answer_text`, `question_revision`, `answer_revision`, latest
feedback JSON, and the question/answer revisions that feedback reviewed. Explicit saves allow
an empty answer. Four bounded `answer_drafts` belong to each question, selected by
`answer_format` (plain_text, car, carl, star). Existing `answer_text` remains exact Plain text
until a structured save. Structured saves atomically persist all drafts and selection;
`answer_text` projects only nonblank active fields, labeled in format order. Legacy text-only
saves update Plain text without deleting alternatives. Each rendered draft and its raw fields
fit the existing answer limit; four supported drafts bound total storage. No conversion or autosave occurs.

The answer revision changes only when the active format or its fields change; inactive
edits preserve feedback currentness. Format changes stale feedback even when projected text
matches. `answer_format_revision` remembers the last selection-change revision, so returning
to an older format cannot revive feedback; formatting-only text edits retain existing normalized-digest freshness. Exact unchanged projected text retains screening coverage and vectors; embedding
revision metadata advances without another provider call. Feedback commands carry the selected
format as bounded control metadata, and results for a different current format are rejected.
Retirement and account export preserve all drafts, including questions answered only in an
inactive format. Preview, rehearsal, anchors and search use active `answer_text` only. The answer limit is
2,000 characters, defined in Rails `config/initializers/text_limits.rb`, Python `text_limits.py`,
and web `src/lib/textLimits.ts`. Answers never become career-library entries. Deleting a set
cascades its questions and nullifies AI task subjects, retaining usage records and task inputs.

Questions also store an optional plain-text `memory_anchor` of up to 600 characters.
Save and feedback mutations require this cue alongside the answer; feedback saves both
before allowance or publication checks. A cue-only change preserves answer revision,
feedback, screening approvals and vectors, and queues no embedding work. An ordinary
unchanged save still schedules the existing embedding job. Cues never enter model
inputs or Q&A embeddings. Answer edits retain cues and the editor reminds the user to
check them. Both fields participate in unsaved-navigation and in-flight draft protection;
only active answer or format edits affect feedback freshness. Bank search includes cues.

`generateInterviewMemoryAnchor` explicitly saves the current answer and cue, then queues
`generate_interview_memory_anchor` through the shared general-AI allowance and task lifecycle.
The command carries owned set/question IDs, source version, type, question/answer revisions,
and digests; it contains no answer or cue text. Python reuses the owned answer reader and
exact screening approvals, with no career-library read. Only the answer enters the prompt.
`interview-memory-anchor-v1` compresses each sentence, in order, into one arrow-separated cue;
behavioral Context/Action/Result/Learning labels become C:/A★:/R★:/L: where supported.
Structured output copies every source sentence to verify complete ordered coverage and
bounds the final anchor to 600 characters. It never supplies new facts or a missing lesson.
Rails applies the result only to the same owned active question, exact answer/question
revisions, unchanged previous cue digest and newest anchor task. Invalid/stale results fail
without changing content; duplicate delivery retains the first terminal outcome and usage.
Users can edit during generation; local drafts survive refresh, and saved concurrent edits
reject the generated result. Reload restores pending generation; failures remain retryable.
Generation is optional: manually written cues remain unrestricted plain text. Accepted cue
changes leave feedback, answer revisions, screening and embeddings alone.

Answered replacement copies the cue to the read-only retired record and clears it on
the active slot. Replacing an unanswered slot clears its cue without retaining a copy.
Failed replacement preserves both. Account export includes active and retired questions
with `memory_anchor` and `retired_at`; deleting questions, sets or accounts removes cues
with their owning records.

`InterviewPrep` services own generation, saving, replacement, feedback, and deletion. GraphQL
exposes owned `interviewQuestionSets` / `interviewQuestionSet(id)` queries, the question-bank
`interviewQuestions` query (newest set first, active slots by position, then retired copies), and the mutations
`generateInterviewQuestionSet(input: {setType: FIT_MOTIVATION | BEHAVIORAL | HYPOTHETICAL | TECHNICAL | KNOWLEDGE})`, `saveInterviewAnswer`, `regenerateInterviewQuestion`,
`requestInterviewAnswerFeedback`, and `deleteInterviewQuestionSet`. Question mutations scope
`questionId` through the owned `questionSetId`. AI work uses the shared usage allowance checks.
Feedback requires a nonblank answer and saves it before allowance checks or queue publication;
screening, budget, or queue failure therefore preserves a valid submitted answer.

Enqueue preparation, answer saving, deletion, and result application serialize on the owner
lock. Result application takes the owner lock before the task lock. Only one queued replacement
or feedback operation may run per question; replacement blocks answer saving, while pending
feedback permits edits. Replacing an answered question requires `confirmed: true`.

Result services check ownership, subject/set/question identity, latest task identity, and
command revisions before writing. Replacement requires unchanged target, peer-question and answer
revisions and checks distinctness against the current set, including the old question. On
success it first keeps a question with any nonblank format draft as a retired copy (below), then increments both
revisions and clears only that slot's answer and feedback; on failure it preserves the old content. Feedback requires an unchanged question and the latest
feedback task. New format-aware commands also require the exact answer revision; stale results
cannot replace coaching after active edits or a format-selection cycle. Legacy commands retain
reviewed-revision attribution for delayed answers. GraphQL `feedbackOutdated` marks active changes outdated. Capitalization and
whitespace changes remain current when a completed task's matching feedback and normalized
answer digest verify that only formatting changed. Exact revisions still advance on saves.
Generated feedback never writes
the answer. Deleted, superseded, or invalid targets fail cleanly. The finished-task guard
prevents duplicate result persistence and usage accounting; failed application still retains
reported usage once.

Question generation requires usable library content; feedback can use an empty library. Both
handlers include screened library-fact responses with separately labeled requirement context.
Context resolves a response's topic or pronouns, but never establishes the candidate's years,
leadership, qualifications, or other personal claims. Only responses receive temporary evidence
IDs or qualify as evidence quotes. Saved field approvals are reused; unchecked context is
screened before use, and a rejected fact entry is omitted. Feedback also screens the submitted
answer and fails closed on rejection or screening unavailability. Existing contact masking, prompt limits, bounded
Pydantic AI runs, versioned prompts, and Logfire tracing apply. Question evidence requires
exact library excerpts; optional feedback excerpts are normalized to exact source text and
invalid excerpts discarded. Feedback validates nonblank prose and at most two placeholders;
personal-fact grounding and knowledge correctness still
requires quality evaluations. Run both interview eval runners after prompt/model/agent changes
(commands in `services/ai/evals/AGENTS.md`); finite, stochastic passes are not a universal
grounding guarantee.

Question input preparation returns prompt text, temporary evidence IDs, and exact quote
coverage together from one career-evidence projection. The worker and offline question
evals share the pure context builder in `model_inputs/interview.py`; the worker binds
that context to checked source values through `screening/interview_question_inputs.py`.
Screening and generated-history provenance stay outside the pure renderer.

Knowledge sets test understanding of subjects explicitly relevant to the career library in
every occupation, including sparse skills-only backgrounds. Five categories cover concepts,
mechanisms, application, reasoning, and limitations. Clearly hypothetical examples can test
application without asserting personal experience. Replacements retain this subject scope
and exclude the intents of all five existing questions. The library selects topics rather
than serving as an answer key. Knowledge coaching identifies factual errors, omissions and
reasoning gaps, then provides a concise corrected illustrative subject answer using model
knowledge. It must never invent personal experience. Fit, behavioral, hypothetical and technical feedback continue
to use only supplied personal facts, with placeholders where needed. Synthetic evals include
nontechnology topics and incorrect answers, with a dedicated knowledge-accuracy judge and
scope-aware grounding rubric. There is no external knowledge ingestion, grading, code
execution, saved-job targeting, or answer-to-library persistence.
Trusted per-run scope selects separate knowledge-feedback instructions, so knowledge calls
never receive personal-fact-only scaffolding rules. The subject-accuracy judge deterministically
skips other scopes; its aggregate measures knowledge cases only.

Fit & motivation covers background, motivation, goals, working preferences, and contribution.
It never invents a target employer or vacancy. Behavioral covers collaboration, problem solving,
adaptation, initiative, and judgment. Hypothetical covers prioritization, ambiguity,
disagreement, quality/risk, and accountability through future workplace behavior and judgment,
without asserting that an event happened. Career evidence provides a familiar setting, even
for technical careers; hypothetical questions do not test technical troubleshooting, design,
implementation, tool choices, or specialist subject facts. This policy applies to new sets
and replacements; saved questions are not rewritten.
These are five coverage guides per set, not prefixes to prepend to questions.

Feedback chooses rules from the trusted saved type. Behavioral uses flexible STAR coaching
without a mandatory template; outcomes and learning stay honest. Fit answers need clear,
relevant reasons, not a story. Hypothetical answers need a proposed approach, priorities,
communication, and verification, not an invented past result. Examples clarify supplied
facts without inventing personal experience, motivation, results, or employers. Technical
and knowledge policies remain separate. Generation and feedback use synthetic quality evals
covering all five scopes, sparse libraries, nontechnology roles, and grounding regressions.

## Retired questions

Replacing an answered slot keeps the old question, answer, revisions, feedback, field approvals,
and Q&A vector as a retired copy in the same set: `retired_at` is set and `position` is null. A
check constraint requires active rows to hold positions 1–5 and retired rows to hold none.
`InterviewQuestionSet#questions` returns only active slots, so generation, replacement
distinctness, recent-question history, screening, and every question mutation ignore retired
copies; they are read-only and cannot be edited, reviewed, replaced, or avoided. Because the copy
keeps the reviewed revisions, its feedback stays current, and its existing vector moves to it.
Unanswered replacements keep no copy. Deleting a set deletes its retired copies too.

## Web

`/practice/questions` (old `/interview-prep` links redirect) is the question bank. It generates a
set of chosen types, shows pending or failed generation, and groups active questions in type tabs with
progress derived from saved state: not answered, no feedback yet, getting feedback, feedback ready,
or out of date. Type tabs and question/answer/cue search run in the browser; rows expand an inline answer editor. Answers from
replaced questions sit in a collapsed read-only section. Generation batches stay a backend detail: only live generation status, failures, and dismissal appear, without batch headings or cards. Empty sets without unfinished work stay hidden.

Practice rehearses active questions with nonblank saved answers from the bank's current
question/answer/memory-anchor search. It starts with the bank type and allows multiple types
through a checkbox selector with saved-answer counts. It starts in the displayed order,
shows one question and optional saved cue, and renders its answer only after Reveal. Navigation
hides the answer, stops at the ends, and focuses the new question; Left/Right arrows work within
rehearsal outside editable fields and modified shortcuts. Shuffle creates a complete permutation;
another shuffled pass can start only after reaching the end. Return restores the bank type, search and
focus; Edit answer returns to the bank and opens that question inline in its type tab. Rehearsal is local UI state with no model calls,
saved sessions, scores, or progress mutations. Empty selections explain how to save answers or
change filters.

Old `/practice/questions/:id/:questionId?` and `/interview-prep/:id?` URLs redirect to the
bank; there is no individual question page. The bank opens one editor at a time and asks
before discarding unsaved answers or memory anchors when changing selection or leaving.
Persisted `latestTask` fields restore subscriptions in the inline editor on reload.
Get feedback sends the typed answer (the server saves it first), so there is no separate save step;
it stays disabled once feedback matches the current text, including formatting-only edits. Cards
show outdated feedback for substantive unsaved changes too and keep replacement locked until the
new question revision is fetched. Replace and "Don't show this again" live in the card's actions menu.

## Avoided questions

“Don't see this again” saves an account-owned question preference independently of the
source set. It does not regenerate, skip, delete, clear drafts, or modify feedback. The
written mutation authorizes the set and question, then checks the selected question revision
under the owner lock. The saved text comes from that persisted question, never browser text.
Duplicate wording (case, spacing, punctuation) saves once, including retries at capacity.
The store allows 50 questions of at most 2,000 characters each and returns explicit errors
at either limit rather than clipping or dropping choices. `avoided` restores saved UI state.

New written generation, replacement and feedback commands contain `source_version: 1`,
set identity and type, with target revisions for replacement/feedback and peer revisions
for replacement. Feedback also stores a SHA-256 digest of the normalized saved answer for
formatting-only freshness checks. Python validates the stored queued task, owner and
subject, then reads the owned sources in one repeatable-read transaction. Feedback loads
only the selected active question's answer, revisions and current field approvals;
changed revisions fail before screening or model work. Question generation loads current
active slots, same-type recent history and saved avoidance preferences. No source text,
answers, field approvals or sibling copies are persisted in these commands. Narrow column
grants allow required answer fields while keeping feedback, vectors, provider receipts
and accounting private.

Unversioned commands and copied source snapshots are unsupported. Stale or deleted sources
fail before generation. All written producers and consumers use the same reference-only contract.

Saved question sets have immutable generated/manual origin. Independent avoidance records
copy that origin and exact question approval when saved, surviving source deletion. Generated
wording uses trusted-generated-source coverage; manual wording is screened before feedback,
history, exclusions, or avoided-preference model use. Receipts approve only matching current
owned values and revisions. Spoken preparation also checks unapproved manual avoidance
preferences through its existing operation-accounted classifier path. It renders
readable delimited exclusions separately from career evidence, preserves contact masking,
and fails explicitly if combined library/preferences exceed the prompt limit. Both the
model validator and Rails result consumer reject exact excluded wording; Rails rechecks
current avoidance preferences at application. Avoiding semantic rewordings remains a
prompt instruction measured by synthetic quality evaluations. Full sets keep their required
categories while choosing different concrete focuses within them.

## Decisions

- **Interview sets have one of five immutable scopes.** General and copied-source
  compatibility paths are removed; there is no historical Q&A to migrate. Technical practice discusses actual role-specific work,
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
  stay fixed when career details change; new generation uses the current library. Repeated generation adds to a unified question bank. Sets remain an internal storage and
  execution boundary; the UI opens individual questions without set numbers, batch navigation,
  or batch deletion. Empty generation requests retain live status and confirmed dismissal. Only answered questions
  that were replaced are kept, as retired copies. Each generated set has five distinct English questions within its selected scope;
  job-specific generation remains future work.

- **Interview feedback coaches the user's answer.** It never fills or replaces the answer
  field and uses placeholders for missing personal facts in personal-fact examples.
  Knowledge examples can correct subject facts without placeholders. Excluding job-derived requirements avoids
  treating an employer's expectations as the user's experience. Revision-bound feedback
  allows editing during AI work while making delayed coaching visibly outdated.

- **Feedback freshness ignores capitalization and whitespace.** Revision changes still track
  exact saved edits, but harmless formatting should not force another AI review. Completed
  task digests verify saved-answer equivalence. Missing or mismatched evidence stays outdated.

- **One successful feedback request per saved version.** Feedback enqueueing checks completed
  task history for the question/answer revision pair under the owner lock. Queued requests
  already prevent overlapping operations; failures can be retried. Saving changed text or
  replacing a question creates a new version. The web button uses persisted feedback revisions
  to remain disabled after success and reload.

- **Interview replacement preserves content until success.** Task identity, revisions, and
  owner-before-task locking prevent obsolete or concurrent results from overwriting newer
  work. Atomic five-slot creation and single-slot replacement avoid partially populated sets
  or clearing unrelated answers. Confirmation protects an answered slot from accidental loss.

- **Replacing an answered question keeps the answer.** Answers are the user's work and the bank's
  value grows as they are refined, so a replacement retires a read-only copy instead of deleting it.
  Copies live in the same table and set rather than a history table so ownership, deletion, vectors
  and GraphQL types stay shared; the nullable position and active-only association keep the five
  slots and all existing slot rules unchanged. Retired copies are not editable, to avoid a second
  feedback and revision lifecycle for rows that no longer belong to a slot.

- **Interview Q&A vectors remain separate from career-library evidence.** Future successful
  nonblank active-answer saves (including unchanged saves and feedback saves, excluding inactive-only draft edits) enqueue a question-specific
  `InterviewPrep::SyncQuestionEmbeddingJob` after commit. `interview_question_embeddings` stores
  original combined Q&A, a model/masked-text digest, source revisions, and a 1536-dimension vector.
  Contact is masked only for the provider. A unique question foreign key cascades deletion;
  edits/clears invalidate vectors in the source transaction. A successful replacement moves an
  answered slot's vector to its retired copy (same content and revisions) and leaves the slot without one.
  The service snapshots and rechecks ownership, content, and revisions under the owner lock,
  releasing it during HTTP. A question advisory lock serializes duplicate jobs. Late results
  cannot restore obsolete content. There is no backfill, search index/interface, library
  promotion, or AI-reader grant. Temporary errors retry; missing configuration logs and skips.
  These independent Rails calls incur provider costs outside AI-task budgets/attempt reports
  and Logfire tracing, like library syncs; feedback tasks do not absorb their costs.


## Custom questions

`createCustomInterviewQuestion` saves a required type and 1–2,000-character question, plus an
optional answer under the existing 2,000-character cap. Under the owner lock it allocates
numbers after current sets and retained generation-task numbers and atomically creates one
manual set with one active position-1 question. Creation needs no library, allowance, AI task,
screening, or embedding job. Subsequent answer saves and feedback retain normal behavior.
Manual sets cannot be replaced: enqueue and result application reject them, and the UI omits
replacement. Save, feedback, avoidance, deletion and filtering use the same bank interfaces.
