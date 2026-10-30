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

Python reads up to 20 saved question texts from the user's most recent
sets of the requested type, ordered by set creation time and ID descending, then slot
position and question ID ascending. This bounded history is prompt-only guidance to
prefer fresh focuses. Familiar themes may recur as practice, and general sets retain
their required introduction. Historical overlap never adds a rejection or retry.
The history is separate from hard avoidance preferences and replacement exclusions;
it is neither career evidence nor proof of personal facts. Only Rails-owned generated
slots supply history, never browser text, answers, or feedback, so the worker reuses
trusted-generated-source coverage without screening those questions again. Legacy tasks
load the same current owned history; copied command text is ignored.

Questions store the user-written `answer_text`, `question_revision`, `answer_revision`, latest
feedback JSON, and the question/answer revisions that feedback reviewed. Explicit saves allow
an empty answer and increment the answer revision only when text changes. The answer limit is
10,000 characters, defined in Rails `config/initializers/text_limits.rb`, Python `text_limits.py`,
and web `src/lib/textLimits.ts`. Answers never become career-library entries. Deleting a set
cascades its questions and nullifies AI task subjects, retaining usage records and task inputs.

`InterviewPrep` services own generation, saving, replacement, feedback, and deletion. GraphQL
exposes owned `interviewQuestionSets` / `interviewQuestionSet(id)` queries, the question-bank
`interviewQuestions` query (newest set first, active slots by position, then retired copies), and the mutations
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
command revisions before writing. Replacement requires unchanged target, peer-question and answer
revisions and checks distinctness against the current set, including the old question. On
success it first keeps a nonblank answer as a retired copy (below), then increments both
revisions and clears only that slot's answer and feedback; on failure it preserves the old content. Feedback requires an unchanged question and the latest
feedback task, but accepts a newer answer revision: coaching is stored against the reviewed
revisions, so GraphQL `feedbackOutdated` marks substantive edits outdated. Capitalization and
whitespace changes remain current when a completed task's matching feedback and reviewed
answer snapshot verify that only formatting changed. Exact revisions still advance on saves.
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
knowledge. It must never invent personal experience. General and technical feedback continue
to use only supplied personal facts, with placeholders where needed. Synthetic evals include
nontechnology topics and incorrect answers, with a dedicated knowledge-accuracy judge and
scope-aware grounding rubric. There is no external knowledge ingestion, grading, code
execution, saved-job targeting, or answer-to-library persistence.
Trusted per-run scope selects separate knowledge-feedback instructions, so knowledge calls
never receive personal-fact-only scaffolding rules. The subject-accuracy judge deterministically
skips other scopes; its aggregate measures knowledge cases only.

General behavioral feedback uses STAR as flexible coaching: brief situation and responsibility,
personal actions, and the actual result. It prioritizes useful gaps and demonstrates clearer
ordering without required fields or a four-part checklist. Unknown, qualitative and negative
results remain honest; having no matching example never becomes invented experience. Examples
use at most two integrated placeholders and remain concise. Introductions and legacy goals or
development questions follow their actual focus instead of forcing a story. The trusted general
scope adds this guidance to the existing personal-fact policy; technical and knowledge policies
remain separate. Newly requested feedback uses the guidance without rewriting saved answers.
Feedback evals cover complete and incomplete stories, no example, uncertain/negative outcomes,
and legacy nonbehavioral questions alongside technical and knowledge regressions.

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
set of a chosen type, shows sets still generating or failed, and lists every active question with
progress derived from saved state: not answered, no feedback yet, getting feedback, feedback ready,
or out of date. Progress and type filters and text search run in the browser. Answers from
replaced questions sit in a collapsed read-only section; finished sets, with answered counts and
confirmed deletion, sit in another.

`/practice/questions/:id/:questionId?` works one question at a time. Without a question id it
pins the first unanswered question (or the first) in the URL, so saving never moves the open
question. The set's five questions form a linked stop line. All cards stay mounted and only the
open one shows, so drafts and task subscriptions survive moving between questions; only leaving
the set warns about unsaved answers. Persisted `latestTask` fields restore subscriptions on reload.
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

New written generation and replacement commands contain `source_version: 1`, set identity
and type, and replacement target/peer revisions. Python validates the stored queued task,
owner and subject, then reads current active slots, same-type recent history and saved
avoidance preferences in one repeatable-read transaction. No source text, answers, field
approvals or sibling copies are persisted in these commands. Narrow column grants keep
answers, feedback and embeddings unavailable to this reader. Feedback retains its old
command format until its separate migration.

Retained generation commands also load current owned history/preferences. Retained
replacement commands must match their target revisions and current target/peer wording;
stale or deleted sources fail before generation. No retained command text becomes prompt
input. During the staged rollout, deploy the new Python readers/grants before new producers;
old workers cannot read reference-only commands. Existing saved command copies are removed
by the final migration, without replaying work.

Saved question slots and avoidance preferences are generated question text, so the handler
uses trusted-generated-source coverage rather than classifying them again. It renders
readable delimited exclusions separately from career evidence, preserves contact masking,
and fails explicitly if combined library/preferences exceed the prompt limit. Both the
model validator and Rails result consumer reject exact excluded wording; Rails rechecks
current avoidance preferences at application. Avoiding semantic rewordings remains a
prompt instruction measured by synthetic quality evaluations. Full sets keep their required
categories while choosing different concrete focuses within them.

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
  numbered/date sets support repeated practice without custom names; only answered questions
  that were replaced are kept, as retired copies. Each set has five distinct English questions within its selected scope;
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

- **Replacing an answered question keeps the answer.** Answers are the user's work and the bank's
  value grows as they are refined, so a replacement retires a read-only copy instead of deleting it.
  Copies live in the same table and set rather than a history table so ownership, deletion, vectors
  and GraphQL types stay shared; the nullable position and active-only association keep the five
  slots and all existing slot rules unchanged. Retired copies are not editable, to avoid a second
  feedback and revision lifecycle for rows that no longer belong to a slot.

- **Interview Q&A vectors remain separate from career-library evidence.** Future successful
  nonblank answer saves (including unchanged saves and feedback saves) enqueue a question-specific
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
