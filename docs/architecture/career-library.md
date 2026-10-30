# Career library and job workflows

Library persistence and retrieval, resume imports, job ingestion, gap analysis, and tailoring. Queue payloads are defined in [AI tasks](ai-tasks.md#queue-messages).

[Architecture overview](../architecture.md) · [AI tasks](ai-tasks.md) · [Interview prep](interview-prep.md) · [AI safety and usage](ai-safety-and-usage.md) · [Career library](career-library.md)

## Memory

User facts are stored as rows with embeddings in pgvector for tasks that need semantic
search. Complete-draft tailoring reads the owned library once and uses its entries directly.

- **What's embedded:** every career library entry: experiences, highlights, projects,
  educations, certifications, skills, and saved career context entries. Each is embedded as
  one text with enough context to stand alone ("Senior Engineer at Acme: Cut deploy time 40%").
  A gap response is embedded only when saved to the library as a `CareerContext`.
- **Storage:** `library_embeddings` (`source_type` + `source_id`, `content`, `content_digest`,
  `model`, `embedding vector(1536)`), HNSW index with cosine distance, in the same Postgres.
- **Model:** OpenAI `text-embedding-3-small` at 1536 dimensions (Rails
  `CareerLibraryEmbeddings`, worker `embedding_model`; they must match).
- **Writing (Rails):** every service that changes library text enqueues
  `CareerLibrary::SyncLibraryEmbeddingsJob` (after commit). `SyncLibraryEmbeddingsService`
  holds a per-user advisory lock, embeds only entries whose SHA-256(model + contact-masked
  text) changed, and deletes rows whose entry is gone. Stored content remains unmasked.
  Repeating the sync with unchanged masked inputs is harmless; it does not refresh stored
  content when the masked input and model remain unchanged.
  `bin/rails career_library:sync_embeddings` backfills all users (e.g. after a model change).
- **Reading (worker):** `memory/embed_search_query.py` embeds the query through Pydantic AI's
  `Embedder` (traced in Logfire). `database/library_embedding_search.py` loads that user's
  rows for the stored model in cosine order (HNSW iterative scans, so the user filter does
  not drop a row). `memory/hybrid_rank.py` then fuses that order with BM25 over the same
  texts (reciprocal rank fusion, k=60). Complete-draft tailoring does not call this search;
  it already has the library snapshot and avoids per-section query embeddings.

## Decisions

- **Ranking receives complete candidate records.** Database search and the retrieval
  evaluation pass immutable `RankedDocument` values (ID, content, cosine distance)
  in nearest-first order to `hybrid_order(documents, query_text)`. The ranking module
  owns the projections required by BM25, reciprocal rank fusion, and tie-breaking.
  This replaces separate ID lists, text pairs, and distance maps that callers had
  to keep aligned. SQL still owns user, model, and source-type filtering; ranking
  scores and ordering rules are unchanged.

- **pgvector over a separate vector DB.** One database to run; enough for this scale.

- **Library search is hybrid.** Cosine order from pgvector is fused with BM25 over the same
  user's embedding texts by reciprocal rank fusion, k=60. Cosine alone misses a row that uses
  the job's exact wording when a semantically nearby row ranks first. BM25 drops English
  stopwords and does not stem; the embedding already covers inflection and synonyms. k=60
  (checked on the golden disagreement case in `tests/test_hybrid_rank.py`) prefers a row that
  both lists rank well over a row that is first on only one. Ties break toward the smaller
  cosine distance. The user and model filters run in SQL before either rank. The
  library-retrieval eval calls the same fusion and reports recall@k, precision@k, and MRR.

- **Rails computes career-library and saved interview Q&A embeddings itself (an exception to "all LLM calls go through
  the AI service").** Embeddings are derived data that Rails can rebuild at any time, and they
  contain no prompt. They are also too large for the result queue: one 1536-dimension vector is
  roughly 8–20 KB as JSON, so a resume import's worth won't fit in a 256 KB SQS message. Two
  alternatives were rejected: letting the worker write embeddings through a second, narrow
  database role (weakens "Rails owns writes"), and returning smaller, packed vectors split
  across several result messages (more moving parts for no product gain). The cost is a few
  hundredths of a cent per library. Rails records embedding receipts in the per-user
  general and combined AI spend, but these background requests use no task admission or
  concurrency slot. Rails' embedding calls aren't traced in Logfire; see
  [AI cost accounting](ai-cost-accounting.md) for receipt and budget details. The sync
  runs as a background job, so an OpenAI outage never blocks an import or an edit. The worker still embeds search queries
  through Pydantic AI, so those calls are traced.

- **The career library is the base; there is no base resume.** Importing a resume fills the
  library and the user's profile (contact details, summary) instead of also creating a base
  resume. A copied base resume would drift from the library as soon as the library was edited
  or a second resume was imported. Resumes are snapshots by design, so they only exist when
  tailored to a job.

- **Keep the career library deduplicated: merge on import, plus manual merge and delete.**
  Importing a resume merges an incoming experience, project, or education into an existing
  entry that matches. Experiences match on company and title, projects on name, and educations
  on institution and degree. Text compares case-insensitively, and if both entries have start
  dates they must be equal. Merging only fills fields that are blank on the kept entry and adds
  highlights it doesn't have; it never overwrites. An experience's blank end date means
  "current", so it is never filled. Duplicates the import doesn't catch can be merged or
  deleted from the library page. Matching keys are deliberately narrow: a missed duplicate is
  one click to fix, but a wrong automatic merge silently loses an entry.

- **Roles, projects, and education are always listed by date; highlights and skills are
  arranged by dragging.** The API orders dated entries most recent first (ongoing first, then
  by end date, undated last; `MostRecentFirst` concern), so a later import can't leave a new
  role at the bottom and there is no manual order to maintain. Highlights can be dragged to a
  new place or into another role (useful when the parser or an earlier merge put a bullet
  under the wrong job), and skills within their category. In the import review this only
  changes the draft in the browser; on the library page each drop is saved right away with
  `reorderSkills` (the full ordered id list, so repeating it is harmless) or
  `moveExperienceHighlight` (moves the existing row, keeping its id, and renumbers both
  roles). The web app updates the Apollo cache before the server answers and refetches if the
  change is rejected. Uses `@dnd-kit/react`, which supports keyboard dragging.

- **Gap analysis speaks in short labels; code fills in the evidence.** The prompt labels each
  qualification (`R1`, `N1`) and library entry (`E1`, `H1`, `P1`, `ED1`, `S1`, `F1`), and the
  agent answers with labels only. The profile summary is shown as unlabeled background for the
  overall writeup and is not evidence, so it cannot be pasted under each requirement. An output
  validator sends missing, repeated, or unknown labels
  back as a retry, then code maps labels to ids and copies the library text as evidence. Short
  labels are cheaper and more reliable than UUIDs in a prompt, and the agent can't invent or
  reword evidence. It only compares the library with the job; it asks no questions.
  Only saved requirements and nice-to-haves are compared, in that order. Saved job
  responsibilities remain available to other features but do not enter gap screening or
  generation. Both Rails and the AI worker reject jobs with neither qualification list;
  nice-to-have-only jobs are supported.
  Gap-analysis preparation screens the projected job first, then all unchecked used fields
  from the complete career library (including summary, highlights, certifications, and saved
  facts) as one structured source. Checked fields are reused. It uses resume import's
  overlapping chunks without the short-note phrase filter. Any
  blocked or incomplete screen stops analysis; entries are never omitted to continue.
  The existing 80,000-character source cap now applies to the assembled library, including
  JSON metadata, and the final prompt retains its 120,000-character cap. Both limits are
  checked before screening calls; oversized sources fail without truncation. Preparation
  rebuilds the exact prompt from approved sources and retains completed screening usage on
  failures. Its small interface keeps serialization, screening, and coverage out of the handler.

- **Gaps are answered in the comparison view, not by an AI asking questions.** The user can
  write a response under any gap or partial match. Responses are saved in Rails per job and
  requirement (keyed by the requirement text, not the analysis run), so re-running the
  comparison keeps them, and each can optionally be added to the career library as a `CareerContext`
  (the requirement plus the answer). Only that fact is embedded and read by later gap analysis;
  an answer left on the job is not. Tailoring
  reads the gap analysis and the responses as inputs. A deferred `ask_user` flow was considered
  and rejected here: the comparison already lists every gap, so a plain form is simpler, needs
  no paused agent runs, and lets the user decide what's worth answering. `ask_user` stays
  used by individual library editing, where the AI rewrites one selected field and may ask for facts.

- **Tailoring returns one complete draft for review.** Section-by-section approval made the
  user wait repeatedly and repeated preparation. One queued execution now owns shared
  evidence and generation behind `tailoring.generate_resume_draft`. Rails snapshots profile
  contact, gap analysis, and gap responses; the worker reads the owned job and library once.
  Before screening or writing, tailoring counts the plain text of every saved library field
  it uses, once per field. At most 80,000 characters may proceed; a larger library fails the
  task with a size message, even if its fields were screened before. Tailoring considers the
  complete fitting library without search or trimming, subject to the existing safety screen.
  The assembled prompt retains its separate 120,000-character cap for large combined job,
  analysis, labels, and library text.
  Contact, every degree, and every certification are copied without a generative call,
  preserving descriptions and credential date precision. Experience, projects, and skill
  selection run concurrently, with at most three writers in flight. The summary follows
  selected original source labels, including copied credentials for sparse libraries.
  Education descriptions are part of screened source evidence, so copied sections need no
  second safety check before the summary. Every saved gap-analysis assessment, including
  verdict, explanation, and cited evidence, is included as writing guidance. The completed
  analysis is worker-produced output and is validated instead of screened again. Saved
  user-written gap responses reuse saved requirement/body checks and receive one grouped
  decision for pending fields before entering prompts. Queued snapshots retain every
  record identity even when rendered text is identical. Metadata never enters prompts;
  job-only answer approvals remain independent of linked CareerContext approvals.
  Complete-source limits still apply to already-approved answers.
  The model selects, orders, and rewrites toward the job without inventing employers,
  titles, tools, dates, metrics, or responsibilities. The model is instructed to cite
  evidence labels for its wording;
  the output checker accepts usable section shape and known labels, with at most one
  repair attempt. It does not judge whether prose claims match the sources. Empty
  citation lists are accepted. The user reviews and edits the draft before saving.
  Empty sections skip generation. A successful optional writer may omit its section with
  an explanation when nothing fits. A failed writer or the shared task deadline cancels and
  awaits outstanding work; no successful fragments are published as a complete draft.
  Transient retries and provider accounting remain task-wide. Career-library records remember
  checked field names in `screened_fields`, including summary on the user and highlight content.
  All library consumers reuse these checks; each screens only unchecked fields it uses.
  Tailoring and summary preparation retain every saved record's identity when several
  sources render the same text. Classification can reuse an exact checked field payload,
  but each record earns reports only for its own checked fields; equal display text alone
  cannot approve a different field selection.
  Interviews exclude career context requirements. Edits remove only changed field names; reordering
  preserves checks. Text editors reload the locked record before assigning changes, so
  an approval earned after an editor loaded cannot remain attached to edited text.
  Profile imports and clearing lock the owner first; merges then lock persisted rows
  in ID order. The edited text and its field-check invalidation save atomically.
  New or changed user text and imported rows start unchecked. Exact saved text retains
  its existing field coverage when a merge copies it or the highlight editor recreates
  an unchanged bullet; edited values never inherit that coverage. Rails applies successful check reports
  from completed or failed AI results to owner-scoped records; Python remains read-only.
  Saved Job field checks also persist with current-value fingerprints (see [AI tasks](ai-tasks.md)).
  Other input and prompt coverage remain execution-local. Library checks have no expiry or policy
  version, and results carry no edit revision check.
  The result stays on the task as ordered section snapshots and warnings. There is no
  tailoring `needs_user_input`, generation counter, submit-section mutation, or reopening
  state. Users edit or exclude sections, preview, then explicitly save once. Save holds the
  owner-then-task locks and records `accepted_at`, creating `Resume` and `ResumeSection` snapshots
  without changing the library. Explicitly excluding every section is rejected. Saved
  resume edits change snapshots; deleting the job keeps the resume. Deleting a saved resume
  removes only its snapshots and leaves acceptance/history intact. Starting again after
  deletion creates a fresh task; an accepted task can never be saved twice. Existing paused
  development tasks have no compatibility path and are not deleted by this change.

- **AI results are reviewed before they change user data.** A parsed resume is stored on the
  `AiTask`; the user edits it and explicitly imports it. Imports append to the career library
  (skills are de-duplicated by name) and can't be repeated for the same task.

- **Resume parsing extracts, never rewrites.** Each extraction group receives the complete
  PDF/DOCX text. The model returns experience highlights directly, without requiring recognized
  list markers or preselected source IDs. Role context determines which passages belong together;
  missing or unfamiliar markers do not make a passage ineligible.
  Bullets are copied word for word and anything
  not stated stays null, so evals can check faithfulness deterministically (every extracted
  highlight, skill, and company must appear in the source text). Ambiguities go into
  `parsing_warnings` instead of questions to the user; the human-in-the-loop flow is
  implemented for AI-assisted rewriting of career library entries. Partial dates ("2021") stay strings until import, where they
  become the first day of the month or year.
  The rule is also enforced at runtime: after every parse, `enforce_source_faithfulness`
  (`services/ai/documents/`) removes highlights and skills that don't appear in the source text
  and only warns about unmatched company, title, project, and institution names, since dropping
  a whole entry over a name mismatch loses too much. Every finding goes into
  `parsing_warnings`, so the user sees it during review. A rule-based parser as the default
  (LLM as fallback) was considered and rejected: text extraction is already procedural, the
  remaining structuring step is where rule-based parsers fail silently on varied layouts
  (columns, heading names, date formats, entry boundaries), and the LLM parse costs well under
  a cent per resume.

- **Saved jobs may have an unknown company.** The title stays required. Rails stores missing
  or blank companies as null on manual creation, editing, and import; GraphQL and worker read
  contexts preserve that absence. Views and prompt labels display **Unknown company** and
  users can add the employer later. Career-library experience employers are unchanged.
  Deploy the nullable database migration and tolerant consumers before a producer emits null.
  Rollback requires real company names for existing null rows: the migration refuses to
  restore NOT NULL until those rows are filled, without inventing names or removing jobs.

- **Job scraping is deterministic and per site; the LLM only sorts scraped bullets by number.**
  Each supported job site gets its own scraper (`services/ai/scrapers/`, one site at a time)
  that reads the site's own markup or data instead of handing a whole page to an LLM.
  Requirements and nice-to-haves come from the posting's own headings ("Requirements",
  "Preferred qualifications", ...). Only when no requirement heading matches does a small agent
  sort the posting's bullets, and it answers with bullet numbers, so every requirement is still
  the posting's exact wording and nothing can be invented. Unsupported sites fail fast in Rails,
  with no AI task.

- **LinkedIn is the first (and only) job site.** Sites must be where job seekers actually find
  jobs and copy links. Applicant tracking systems (Greenhouse, Lever, Ashby) were rejected: many
  companies embed them in career pages that open jobs in pop-ups, with no copyable posting link.
  Indeed, Glassdoor, and ZipRecruiter block plain HTTP requests. LinkedIn gives every job a
  link, and its signed-out guest job page
  (`/jobs-guest/jobs/api/jobPosting/<id>`) returns stable HTML without a login. LinkedIn's terms
  forbid scraping, so we only ever fetch the single job a user pasted (no crawling), and a page
  without a job title fails the task instead of saving an empty job.

- **Scraped jobs are saved without a review step.** Unlike a parsed resume, a scraped job
  changes nothing the user already has: it only adds a Job whose fields are copied from the
  posting. So Rails creates it as soon as the result arrives, and the web app opens it (after
  showing any scraper warnings, e.g. "AI sorted the requirements"). This is the exception to
  "AI results are reviewed before they change user data". Creating the Job inside
  `ApplyAiResultService`'s row lock keeps redelivered results from creating it twice.

## AI section review

Summary, Experience, Projects, and Career context each have an explicit section review action.
They return individual red/yellow/green assessments with short reasons for the summary, role
descriptions/highlights, project descriptions, or saved career context responses without changing career facts.
Each may also include up to three focused, distinct questions about missing contribution, context,
method, or outcome, in priority order. Complete evidence and wording-only improvements need no questions, and
questions never require metrics. These independent questions are stored with the completed
review rather than pausing the section for a deferred tool answer. Current questions appear
beside their assessed details and in the selected AI workspace; stale questions are hidden.
The canonical ordered `questions` list is empty when no question is useful. Legacy saved scalar
questions become one-item lists; the scalar `question` remains the first question for older clients.
Each question is bounded at 500 characters. Repeated questions, including casing/whitespace variants,
are rejected rather than offered as separate gaps. Accepted/discarded answers retire the whole set.
Contact details, credentials, skill names, and career context requirement labels stay outside AI edits.
Snapshots and results live on the existing `review_library_section` AI task; there is no
separate assessment table. Only the selected section reaches screening and generation.
The snapshot includes existing field checks, and unchecked used fields are screened before
plain labeled text reaches the model. Generated assessments are not screened.

Per-record source/context digests mark old grades as needing review when text changes, highlights
move, or entries merge. Deleted targets disappear from current assessments. Result application
validates exact target coverage, and late screening reports can only approve fields whose saved
values still match the snapshot under a record lock. Live progress uses existing task subscriptions.

Individual edits use only the selected record context. Accepting a project or career context revision
queues the existing embedding sync; the profile summary is read live and needs no embedding job.
Exact accepted generated text reuses field coverage until a manual edit changes that text.
Reviews and revisions grade the career evidence, not the polish added by the writer. A
retained vague contribution claim stays yellow or red until the missing detail is resolved.
The editor asks what the person actually did when that fact is missing, unless they have
already said the detail is unavailable or skipped it. Concrete observation/shadowing can
be strong evidence without implying hands-on duties.
Merging a saved entry or editing a neighboring bullet preserves coverage for exact unchanged
copies, so those operations do not send generated text back through the classifier.

### Answering review questions

The current review question set starts one proposal through `answerLibraryReview`.
All questions appear together, with optional answer fields and one submit action. At least one
trimmed answer is required in both the UI and Rails. The browser sends the completed review ID,
target identity, and answered zero-based question indices; Rails resolves question text and
selected-record context itself. Blank fields are omitted without reindexing later answers.
Repeated/out-of-range indices, oversized answers, and entirely blank batches cannot queue work.
Each answer may use up to 4,000 characters, within the existing whole-task input limit.
Older scalar-answer clients still answer the first question. Each assessment exposes its own
`reviewTaskId`, because the latest section task can be queued or failed while assessments
still come from an earlier completed review. Changed, moved, merged, deleted, or superseded
sources cannot start a proposal from an obsolete question.

Answers use the existing individual editing task and selected-detail workspace. Every
answered field is screened; each exact generated question is trusted guidance, not evidence
that its premise happened. Regeneration proposes wording from known facts without pausing
for another question. It changes only the selected field when the user accepts. Independent
Improve with AI keeps its existing feedback and deferred-question workflow.

Revisions use supplied qualitative outcomes without appending claims that missing metrics or
other unsupplied results are unknown. Remaining evidence gaps belong in the assessment reason,
not in the career text. Explicit source/user qualifications, such as an ongoing pilot whose
effect has not yet been evaluated, still constrain the revision. Prior generated drafts are
not new factual evidence for unsupported caveats.

The owner lock serializes answer starts with other edits. Equivalent trimmed answer batches
return the same task regardless of submission order; changing any answered field conflicts.
Repeating an existing scalar answer returns the latest linked turn without another enqueue; a different initial answer or unrelated live
draft returns a conflict instead of replacing work. Failed generations show Retry revision,
which creates a linked editing turn and preserves every saved question/answer pair. A failed
batch can replay with no new feedback; completed ordinary edits still require feedback to continue.
Accepted answers retire their question through the accepted assessment overlay, including
when the accepted wording is unchanged. Discarded answers also hide that review question;
a fresh explicit section review can offer a new question. Closing a workspace preserves work.


### Career context naming and deployment

Saved requirement/response pairs use `CareerContext`, the `career_contexts` table and
association, GraphQL `careerContexts` and `createCareerContext` / `updateCareerContext` /
`deleteCareerContext`, and the `career_context` evidence/edit discriminator. Python library
snapshots use `career_contexts`. The frontend section uses `library.career_contexts`.

Migration `20261028090000` renames the existing table and job-answer foreign-key column,
preserving UUIDs, ownership, uniqueness, nullification, screening checks and vector rows.
It changes structural identifiers in saved AI review/edit/gap-analysis snapshots, frozen
interview sources and references. It does not replace words inside user text or message
history. Existing embedding text keeps its `Fact:` prefix to avoid unnecessary provider
calls; new source identities and all domain interfaces use `CareerContext`.

For deployment, stop accepting new requests, let active AI executions finish and drain
their result queue, then pause consumers. Run the migration and deploy Rails, AI workers
and the frontend together before resuming requests and consumers. Already-published task
bodies are normalized at the Python queue boundary to match migrated Rails snapshots.
The GraphQL rename requires the matching frontend; old clients must reload. Rollback
requires the same coordinated pause and the migration’s `down` before restoring old code.
