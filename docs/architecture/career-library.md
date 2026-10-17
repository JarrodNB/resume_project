# Career library and job workflows

Library persistence and retrieval, resume imports, job ingestion, gap analysis, and tailoring. Queue payloads are defined in [AI tasks](ai-tasks.md#queue-messages).

[Architecture overview](../architecture.md) · [AI tasks](ai-tasks.md) · [Interview prep](interview-prep.md) · [AI safety and usage](ai-safety-and-usage.md) · [Career library](career-library.md)

## Memory

User facts are stored as rows with embeddings in pgvector, so the AI service can retrieve the
ones relevant to a task (e.g. the library entries closest to each job requirement when
tailoring) instead of sending everything.

- **What's embedded:** every career library entry: experiences, highlights, projects,
  educations, skills, and saved library facts. Each is embedded as one text with enough context to stand alone
  ("Senior Engineer at Acme: Cut deploy time 40%"). A gap response is embedded only when saved to the library as a `LibraryFact`.
- **Storage:** `library_embeddings` (`source_type` + `source_id`, `content`, `content_digest`,
  `model`, `embedding vector(1536)`), HNSW index with cosine distance, in the same Postgres.
- **Model:** OpenAI `text-embedding-3-small` at 1536 dimensions (Rails
  `CareerLibraryEmbeddings`, worker `embedding_model`; they must match).
- **Writing (Rails):** every service that changes library text enqueues
  `CareerLibrary::SyncLibraryEmbeddingsJob` (after commit). `SyncLibraryEmbeddingsService`
  holds a per-user advisory lock, embeds only entries whose SHA-256(model + text) changed, and
  deletes rows whose entry is gone, so running it twice is harmless and any run repairs drift.
  `bin/rails career_library:sync_embeddings` backfills all users (e.g. after a model change).
- **Reading (worker):** `memory/embed_search_query.py` embeds the query through Pydantic AI's
  `Embedder` (traced in Logfire). `database/library_embedding_search.py` loads that user's
  rows for the stored model in cosine order (HNSW iterative scans, so the user filter does
  not drop a row). `memory/hybrid_rank.py` then fuses that order with BM25 over the same
  texts (reciprocal rank fusion, k=60). Tailoring queries it once per written section.

## Decisions

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
  hundredths of a cent per library, so embeddings don't count toward the per-user AI budget,
  and Rails' embedding calls aren't traced in Logfire. The sync runs as a background job, so
  an OpenAI outage never blocks an import or an edit. The worker still embeds search queries
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
  requirement (`R1`, `N1`) and library entry (`E1`, `H1`, `P1`, `ED1`, `S1`, `F1`), and the
  agent answers with labels only. The profile summary is shown as unlabeled background for the
  overall writeup and is not evidence, so it cannot be pasted under each requirement. An output
  validator sends missing, repeated, or unknown labels
  back as a retry, then code maps labels to ids and copies the library text as evidence. Short
  labels are cheaper and more reliable than UUIDs in a prompt, and the agent can't invent or
  reword evidence. It only compares the library with the job; it asks no questions.

- **Gaps are answered in the comparison view, not by an AI asking questions.** The user can
  write a response under any gap or partial match. Responses are saved in Rails per job and
  requirement (keyed by the requirement text, not the analysis run), so re-running the
  comparison keeps them, and each can optionally be added to the career library as a `LibraryFact`
  (the requirement plus the answer). Only that fact is embedded and read by later gap analysis;
  an answer left on the job is not. Tailoring
  reads the gap analysis and the responses as inputs. A deferred `ask_user` flow was considered
  and rejected here: the comparison already lists every gap, so a plain form is simpler, needs
  no paused agent runs, and lets the user decide what's worth answering. `ask_user` stays
  reserved for a later feature where the AI rewrites career library entries and must ask for facts.

- **Tailoring pauses once per section, in code, not via `ask_user`.** Contact is copied from
  the user profile with no model call. Rails snapshots contact, the gap analysis, and gap
  responses into the task input. The worker reads `name`, `contact_email`, and `phone` and
  replaces those known values with placeholders before a model call or a Logfire trace. Then one
  agent run writes summary, experience, projects, education, and skills, in that order. The model selects,
  orders, and rewrites toward the job, and must not invent employers, titles, tools, dates,
  metrics, or responsibilities. Each bullet cites library, gap-response, or approved-section
  labels; a checker rejects unsupported claims and does not replace the rewrite with the
  original library text. The agent may say nothing in the library fits; the user can leave that
  section out or ask for a draft anyway, still only from the library. Each written section
  retrieves library rows from that section's job requirements. The same `AiTask` is requeued
  per section. `generation` on the task and on the result lets `ApplyAiResultService` ignore a
  redelivered earlier `needs_user_input`, so it cannot rewind the draft. `needs_user_input` is
  not finished and does not count as in-flight. Gap-response bodies and the user's submitted
  section text go through the same Jev screen before the next prompt. A blocked section edit
  is rejected and the section stays open (the writer is not called). A blocked gap response is
  omitted with a warning. After the last section the task completes with the draft on the task.
  Save creates `Resume` and `ResumeSection` snapshots once (`accepted_at`). Deleting the job
  keeps the resume.

- **AI results are reviewed before they change user data.** A parsed resume is stored on the
  `AiTask`; the user edits it and explicitly imports it. Imports append to the career library
  (skills are de-duplicated by name) and can't be repeated for the same task.

- **Resume parsing extracts, never rewrites.** Bullets are copied word for word and anything
  not stated stays null, so evals can check faithfulness deterministically (every extracted
  highlight, skill, and company must appear in the source text). Ambiguities go into
  `parsing_warnings` instead of questions to the user; the human-in-the-loop flow is
  planned for AI-assisted rewriting of career library entries. Partial dates ("2021") stay strings until import, where they
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
