# AGENTS.md — services/ai

## Purpose

All LLM work: resume parsing, job URL scraping and pasted job ads into structured profiles, gap analysis,
resume tailoring, interview questions and answer coaching, and long-term user memory. Traced in Logfire.

## Stack

Python SQS workers (ElasticMQ locally), boto3, Pydantic, Pydantic AI
(agents, tools, structured outputs) on OpenAI models, Pydantic Evals, Logfire, pgvector for memory
retrieval. Existing queue workers use exec health probes. Basic Interview has an approved
separate FastAPI runtime planned. Its private audio helpers already validate sealed
capabilities and decode audio offline; execution and scheduling follow in the runtime slice.

## Local Rules

- Workers consume task messages from SQS and publish results to the `ai_results` queue.
  Basic Interview is the scoped exception: a separate FastAPI process claims durable
  operations and returns results through authenticated internal Rails HTTP. Rails still
  owns every domain write; existing queued features keep their transport and behavior.
  See docs/architecture/interview-sessions.md for the boundary and staged implementation.
  The database connection uses the read-only `ai_reader` role (career library and jobs for gap
  analysis; career library embeddings for memory retrieval); never attempt writes. Rails writes
  the embeddings; the worker only embeds search queries. Every query is scoped by the task
  message's `user_id`, and SQL lives only in `database/`. Rails grants the role its tables
  (`lib/ai_reader_access.rb`); a new table needs a grant there. Queued-task uploaded files are read (never written) from the S3 uploads bucket by
  their Active Storage blob key.
- Interview audio uses Rails-issued capabilities through a separate client with no application
  credentials. Validate exact storage origins, checksum/size and fully decoded duration before
  provider calls; never rewrite signed URLs or use bucket credentials for interview audio.
- Receive one message at a time, and delete it only after its result is published. Task
  handlers must be safe to run twice, because SQS can redeliver.
- **All LLM work uses Pydantic AI agents.** Never call the OpenAI SDK directly.
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
  resumes with that history plus `DeferredToolResults`. Not built yet; reserved for
  AI-assisted rewriting of career library entries. Gap analysis doesn't ask questions.
  Tailoring generates one complete draft per queued execution and does not use `ask_user`.
- **User-written text is screened by Jev before it enters a prompt** (`screening/`), including
  an uploaded resume before it is parsed. A missing `TYPESAFE_API_KEY` omits the text. An
  attempted JEV failure uses the separate Nano safety classifier within the remaining deadline
  (three seconds maximum for each JEV run). If both fail, omit the text; a blocked resume
  fails the import. Screen each cohesive untrusted input once
  per task execution for job text, answers, and reused questions. Saved career-library fields
  reuse database approvals; unchecked fields screen on first use, and edits clear their checks.
  Large inputs use overlapping chunks. Optional rejected inputs are omitted with warnings;
  required rejected inputs prevent generation. Every generative agent declares an official
  Harness `InputGuardrail` through `capabilities`. Trusted builders bind exact assembled
  prompts to approved sources so the guard does not screen them again; new direct input
  and unknown user/tool history still receive screening before the provider request.
  Only career-library field approvals persist across tasks, through final queue results.
  Both safety classifiers are exempt from recursive screening. All actual chunk requests count toward task usage under their actual model, including validation retries
  and requests before a block or failure. Missing usage stays unknown.
- **Every agent has evals** in `evals/`, written with Pydantic Evals:
  - One dataset file per agent (`evals/datasets/tailoring_cases.yaml`) and one runner per
    agent (`evals/run_tailoring_evals.py`).
  - Use deterministic evaluators where possible; use LLM-as-judge only for subjective
    checks (relevance, question quality, faithfulness).
  - Test data is synthetic or anonymized. Never commit real user resumes.
  - Report results to Logfire. Run evals after any prompt, model, or agent change:
    `docker compose run --rm ai python -m evals.run_tailoring_evals` (Jev screen:
    `docker compose run --rm ai python -m evals.run_user_text_screen_evals`).
    Interview agents: `docker compose run --rm ai python -m evals.run_interview_questions_evals`
    and `docker compose run --rm ai python -m evals.run_interview_feedback_evals`.

## Documentation

Use docstrings for public interfaces, LLM tools, and non-obvious behavior or side effects.
Tool descriptions and model field descriptions are model-facing contracts: keep them precise.
Use a short plain-English module docstring following the root file-header guidance;
explain the job and important limits. Tiny, self-explanatory files and generated code can
skip it. Export indexes are not required.

## Contents

- `conversation_logging/` — local-only readable Markdown exchanges grouped by user and
  job, interview question set, or import task; concrete requests are captured after masking.

- `worker/` — polling loop, message models, task dispatch and handlers, settings, SQS and S3
  clients, Logfire tracing (see `worker/AGENTS.md`)
- `agents/` — Pydantic AI agents (`resume_parsing_agent.py`, `parse_job_posting_agent.py`,
  `job_requirements_sorting_agent.py`,
  `gap_analysis_agent.py`, `user_text_screen_agent.py`, `resume_tailoring_agent.py`,
  `interview_questions_agent.py`, `interview_feedback_agent.py`)
- `prompts/` — agent instructions
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
- `tailoring/` — section order, retrieval, labeled sources, the section prompt, the
  faithfulness check, and turning the agent's draft into resume section JSON
- `documents/` — PDF/DOCX text extraction
- `pii/` — local import contact detection, opaque task-local replacements, and restoration;
  bundled Presidio/spaCy assets, coverage limits, and licenses are documented in its README
- `scrapers/` — deterministic per-site job posting scrapers (LinkedIn so far), no LLM
- `job_postings/` — job description to plain text and requirement bullets (headings first,
  sorting agent as fallback)
- `evals/` — Pydantic Evals datasets, evaluators, and runners
- `tests/` — pytest suite (`docker compose run --rm ai pytest`)
- `pyproject.toml` / `uv.lock` — dependencies, managed with `uv`
  (add one with `docker compose run --rm ai uv add <package>`, then rebuild)
- `Dockerfile.dev` — local dev image (virtualenv at `/opt/venv`)
- `.env.example` — secrets template
