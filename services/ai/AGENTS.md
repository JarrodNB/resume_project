# AGENTS.md — services/ai

## Purpose

All LLM work: resume parsing, job URL scraping and pasted job ads into structured profiles, gap analysis,
resume tailoring, interview questions and answer coaching, and long-term user memory. Traced in Logfire.

## Stack

Python SQS workers (ElasticMQ locally), boto3, Pydantic, Pydantic AI
(agents, tools, structured outputs) on OpenAI models, Pydantic Evals, Logfire, pgvector for memory
retrieval. Existing queue workers use exec health probes. The shared FastAPI app starts at
`app.py` and runs integrated interview execution using explicitly configured providers.
Its lifespan supervises Rails claims and cleanup; private audio helpers validate sealed
capabilities and decode audio offline. `interviews/fixture_app.py` is isolated offline
test support. See docs/architecture/interview-sessions.md.

## Local Rules

- `execution/runner.py` is the shared bounded execution/lease supervisor. Feature
  adapters own claims, provider calls and Rails acceptance. Its optional output sink
  does not create a second scheduling or accounting lifecycle. `/internal/executions`
  receipts acknowledge a nudge only; Rails owns durable delivery and watchdog jobs.

- Workers consume task messages from SQS and publish results to the `ai_results` queue.
  Basic Interview is the scoped exception: a separate FastAPI process claims durable
  operations and returns results through authenticated internal Rails HTTP. Rails still
  owns every domain write; existing queued features keep their transport and behavior.
  See docs/architecture/interview-sessions.md for the boundary and staged implementation.
  The database connection uses the read-only `ai_reader` role (career library and jobs for gap
  analysis; career library embeddings for memory retrieval); never attempt writes. Rails writes
  the embeddings; the worker embeds search queries and bounded job-listing excerpts for optional reranking. Every query is scoped by the task
  message's `user_id`, and SQL lives only in `database/`. Rails grants the role its tables
  (`lib/ai_reader_access.rb`); a new table needs a grant there. Queued-task uploaded files are read (never written) from the S3 uploads bucket by
  their Active Storage blob key.
- Interview audio uses Rails-issued capabilities through a separate client with no application
  credentials. Validate exact storage origins, checksum/size and fully decoded duration before
  provider calls; never rewrite signed URLs or use bucket credentials for interview audio.
- Receive one message at a time, and delete it only after its result is published. Task
  handlers must be safe to run twice, because SQS can redeliver.
- The separate fake interview runtime intentionally disables real provider requests and
  remote telemetry, even if unrelated provider credentials exist in its environment. Its
  injected fake classifiers still exercise shared screening and guardrails.
- **All dialogue/reasoning LLM work uses Pydantic AI agents.** Never call the OpenAI SDK directly.
  The approved spoken-interview audio exception uses bounded HTTP adapters only for
  transcription and exact saved-text speech, behind Rails-owned per-dispatch accounting.
  It does not perform dialogue reasoning. See docs/architecture/interview-provider-accounting.md.
  - One agent per file (`agents/gap_analysis_agent.py`), with a Pydantic model as its `output_type`.
  - Keep related tools together in their domain and register them on the agents that need them.
  - Workers inject per-task context (user ID, retrieved memories) through the agent's `deps`.
- Instructions/system prompts live in their own files (`prompts/`), one per file, with descriptions of non-obvious inputs/outputs.
- Use Pydantic models for every queue message and every structured LLM output.
- **Logfire tracing** comes from Pydantic AI's OpenTelemetry instrumentation
  (`Agent.instrument_all()` at worker startup). Tag traces with the user ID and task ID,
  and flush at the end of each task. Known name, contact email, and phone are placeholders
  on the trace and on the provider request. Resume imports also detect names, emails,
  and phones locally with `pii/` before screening; structured output is restored before
  source checks. Detection is probabilistic, especially for unfamiliar names. Keep task
  privacy active through parent span completion and exception logging. Remote export is enabled only when
  `LOGFIRE_TOKEN` is set in `services/ai/.env` (copied from `.env.example`, never committed).
  `LOGFIRE_ENVIRONMENT` labels environments; export does not prompt for login.
- **Human-in-the-loop uses Pydantic AI deferred tools.** When an agent needs information
  from the user, it calls an external `ask_user` tool and the run ends with
  `DeferredToolRequests`. The worker publishes a `needs_user_input` result containing the
  question(s) and the serialized message history. When the user answers, the follow-up task
  resumes with that history plus `DeferredToolResults`. Career-library editing implements
  this with distinct linked tasks per turn; browser input never supplies saved agent history.
  Its handler restores exact coverage for previous checked/generated messages and screens
  only new feedback/answers. Completed career-library section reviews are a scoped
  exception: they return independent optional enrichment questions with their assessments,
  without pausing a section-wide agent. Answers start separate individual regeneration
  tasks, rather than resuming review history. Gap analysis doesn't ask questions.
  Tailoring generates one complete draft per queued execution and does not use `ask_user`.
- **User-written text is screened for prompt injection before it enters a prompt** (`screening/`), including
  an uploaded resume before it is parsed. Jev, local Llama Prompt Guard, and a configurable LLM are selectable
  primary and fallback models. A missing `TYPESAFE_API_KEY` prevents a Jev call. An attempted
  primary failure uses the configured fallback within the screening deadline
  (three seconds maximum for each JEV run). If both fail, omit the text; a blocked resume
  fails the import. Screen each cohesive untrusted input once per task execution. User-written
  interview answers remain screened; exact Rails-owned AI-generated interview questions are
  trusted by provenance when reused. Saved job and career-library fields
  reuse database approvals; unchecked fields screen on first use, and edits clear their checks.
  Large inputs use overlapping chunks. Optional rejected inputs are omitted with warnings;
  required rejected inputs prevent generation. Every generative agent declares an official
  Harness `InputGuardrail` through `capabilities`. Trusted builders bind exact assembled
  prompts to approved sources so the guard does not screen them again; new direct input
  and unknown user/tool history still receive screening before the provider request.
  A validated completed gap-analysis result can be trusted as generated output within
  one tailoring execution; saved gap-response requirement/body approvals are reused, with pending fields screened
  together once and fingerprinted reports retained for every saved answer ID.
  The spoken-interview runtime is a scoped conversational exception: it reconstructs prior
  dialogue from authenticated Rails-owned public utterances and screens only the newest
  candidate message with `screening/conversation.py`. Frozen library field approvals are
  carried in the private claim and newly checked fields are persisted through its fenced
  Rails callback before generation. Preparation also persists an exact frozen career-focus
  fingerprint through that callback and requires its receipt before generation, including
  focus-only checks; retries reuse only matching fingerprints. Existing queued features retain their current guard.
  Job and career-library field approvals persist across ordinary tasks through final queue results.
  Job checks cover title, company, requirements and nice-to-haves for ordinary queued tasks;
  spoken interviews also freeze and check description and responsibilities. Their `jobs`
  sources share the fenced frozen-source receipt, while readable vacancy expectations stay
  separate from candidate evidence. Saved-job preparation outputs `role: null`; Rails retains
  the authoritative job instead of accepting model-authored role details. Fingerprinted
  reports can approve only matching current fields on the task's owned job. All new jobs start unchecked.
  Both safety classifiers are exempt from recursive screening. All actual chunk requests count toward task usage under their actual model, including validation retries
  and requests before a block or failure. Missing usage stays unknown.
- **Every agent has evals** in `evals/`, written with Pydantic Evals:
  - Basic Interview preparation and spoken dialogue are an explicitly scoped first-iteration
    exception: automated quality datasets, evaluators and LLM judges remain deferred.
    Verify contracts offline and use bounded representative provider smoke checks; do not
    report deterministic tests as evidence of interview quality.
  - One dataset file per agent (`evals/datasets/tailoring_cases.yaml`) and one runner per
    agent (`evals/run_tailoring_evals.py`).
  - Use deterministic evaluators where possible; use LLM-as-judge only for subjective
    checks (relevance, question quality, faithfulness).
  - Test data is synthetic or anonymized. Never commit real user resumes.
  - Report results to Logfire. Run evals after any prompt, model, or agent change:
    `docker compose run --rm ai-worker python -m evals.run_tailoring_evals` (Jev screen:
    `docker compose run --rm ai-worker python -m evals.run_user_text_screen_evals`).
    Interview agents: `docker compose run --rm ai-worker python -m evals.run_interview_questions_evals`
    and `docker compose run --rm ai-worker python -m evals.run_interview_feedback_evals`.

## Documentation

Use docstrings for public interfaces, LLM tools, and non-obvious behavior or side effects.
Tool descriptions and model field descriptions are model-facing contracts: keep them precise.
Use a short plain-English module docstring following the root file-header guidance;
explain the job and important limits. Tiny, self-explanatory files and generated code can
skip it. Export indexes are not required.

## Contents

- `conversation_logging/` — local-only readable Markdown exchanges grouped by user and
  individual AI task, with redeliveries appended to that task file; concrete requests are captured after masking.

- `app.py` — shared FastAPI startup and interactive AI HTTP service composition
- `worker/` — queue polling, envelopes, task dispatch/handlers, SQS/S3 clients and task-only
  profile/tracing adapters (see `worker/AGENTS.md`)
- `settings.py` — `AISettings` for reusable model, screening, limits and read-only retrieval
  options; `worker/settings.py` extends it with queue/storage delivery settings
- `llm/` — generative model selection, per-request usage accounting, pricing and run limits
- `privacy/` — explicit known-contact/import masking for model input, output and embeddings
- `telemetry/` — process-independent Logfire instrumentation, privacy processors, prompt
  labels and bounded export flushing
- `agents/` — Pydantic AI agents (`resume_parsing_agent.py`, `parse_job_posting_agent.py`,
  `job_requirements_sorting_agent.py`,
  `gap_analysis_agent.py`, `user_text_screen_agent.py`, `resume_tailoring_agent.py`,
  `interview_questions_agent.py`, `interview_feedback_agent.py`)
- `prompts/` — agent instructions
- `model_inputs/` — deterministic workflow-specific user-text rendering from selected, screened sources
- `schemas/` — structured output models (`ParsedResume`, `ParsedJobPosting`, `ScrapedJobPosting`,
  `SortedRequirementBullets`, `GapAnalysis`), the gap analysis input (`GapAnalysisContext`), and
  `LibrarySearchMatch` (a similarity search hit)
- `database/` — read-only Postgres access (`ai_reader`): the job and career library for gap
  analysis, and similarity search over `library_embeddings`
- `memory/` — embeds search queries (Pydantic AI `Embedder`) and fuses cosine order with BM25
- `gap_analysis/` — gap analysis prompt building (short labels), output checks, copying
  evidence text from the library, and required whole-library preparation before generation
- `text_limits.py` — character caps checked before Jev and generative runs (the same numbers
  Rails stores in `TextLimits`)
- `screening/` — Jev yes/no screen for user-written text, plus a short phrase check for
  obvious instruction overrides. A string over the screen cap is rejected before the call
  (`too_long`)
- `tailoring/` — section order, labeled sources, the section prompt, output-shape
  and label checks, and turning the agent's draft into resume section JSON
- `documents/` — PDF/DOCX text extraction
- `pii/` — local import contact detection, opaque task-local replacements, and restoration;
  bundled Presidio/spaCy assets, coverage limits, and licenses are documented in its README
- `scrapers/` — deterministic per-site job posting scrapers (LinkedIn so far), no LLM
- `job_postings/` — job description to plain text and requirement bullets (headings first,
  sorting agent as fallback)
- `evals/` — Pydantic Evals datasets, evaluators, and runners
- `tests/` — pytest suite (`docker compose run --rm ai-worker pytest`)
- `pyproject.toml` / `uv.lock` — dependencies, managed with `uv`
  (add one with `docker compose run --rm ai-worker uv add <package>`, then rebuild)
- `Dockerfile.dev` — local dev image (virtualenv at `/opt/venv`)
- `.env.example` — secrets template
