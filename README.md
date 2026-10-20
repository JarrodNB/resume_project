<!-- Description: Public overview and development guide for Resume Project.
Index: Overview, Capabilities, AI engineering, Architecture, Getting started, Development, Documentation. -->

# Resume Project

An AI-assisted job search application for building tailored resumes, organizing career
experience, and managing applications. It brings resume preparation, job analysis, and
interview practice into one workflow, with users reviewing and refining AI-generated content.
The project combines retrieval-augmented generation (RAG), structured model outputs,
prompt injection defenses, and evaluation workflows in a full-stack application.

## Capabilities

- **Career library:** Organize experience, education, projects, skills, and certifications
  in a reusable profile.
- **Resume import:** Extract information from PDF and DOCX resumes for review and import.
- **Resume tailoring:** Adapt resume content to a job posting and export it as a PDF.
- **Job management:** Save job postings and track applications through their stages.
- **Gap analysis:** Compare a career profile with job requirements and capture additional evidence.
- **Interview preparation:** Generate job-specific questions, save answers, and receive feedback.

## AI engineering

### Retrieval-augmented generation

Resume tailoring retrieves career evidence for each section using the role and job requirements.
[Hybrid search](services/ai/database/library_embedding_search.py) combines pgvector cosine
ranking with BM25 keyword ranking through reciprocal rank fusion. Queries are scoped to
the user and embedding model; the highest-ranked entries ground the section's context.
[Section retrieval](services/ai/tailoring/retrieve_for_section.py) selects up to eight entries
and falls back to the full library when no matching embeddings exist.

### Prompt injection defenses and grounded outputs

[Input guardrails](services/ai/screening/prompt_guardrail.py) are registered on every
generative agent through Pydantic AI's `capabilities` parameter, using the official Harness
`InputGuardrail`. TypeSafe Jev screens the complete assembled prompt—including uploaded,
scraped, saved, and retrieved content—before the first generative model request. The guard
runs sequentially; missing credentials, screening errors, or rejected input stop generation.
Supplied user/tool history is also screened. Earlier field checks support targeted feedback;
the final guard checks the remaining context. Jev itself is excluded to avoid recursion.
Adversarial eval cases cover embedded instructions and legitimate security-related content.

Pydantic schemas constrain model output. Resume parsing applies
[source-faithfulness checks](services/ai/documents/enforce_source_faithfulness.py), while
[tailoring validators](services/ai/agents/resume_tailoring_agent.py) check evidence labels
and unsupported claims, requesting a retry when validation fails. These checks reduce
unsupported output; users review generated content before using it.

### Evaluations

[Pydantic Evals suites](services/ai/evals/) use synthetic, labelled datasets and task-specific
evaluators. Runs attach scores to Logfire traces for comparison across prompt and model changes.

| Area | Evaluation focus |
| --- | --- |
| Retrieval | Hit@1, Recall@K, Precision@K, and mean reciprocal rank using production ranking code |
| Resume parsing and tailoring | Source faithfulness, section recall, relevance, and embedded instructions |
| Job extraction and gap analysis | Field accuracy, verbatim requirements, verdict accuracy, and evidence validity |
| Input screening | Screening decisions and classifier answers on benign and adversarial inputs |
| Input capabilities | Allow/block decisions on assembled context, including stored and retrieved attacks |
| Interview preparation | Deterministic structure/evidence checks and input-aware LLM judges |

Retrieval evals exercise embeddings and ranking without PostgreSQL. Generative agent evals
also run the input capability and require TypeSafe credentials; blocked cases stop before
generation. Capability tests use fake providers to verify rejection before any generative call.
Subjective judge scores serve as review signals. Evaluator unit tests check scoring logic.

### Observability and reliability

Logfire instruments agents and embeddings, with contact masking in traces. Workers enforce
request, token, and execution-time limits, and use a fallback model for transient provider
failures. Rails applies queue results with duplicate-delivery and stale-generation checks,
tracks model usage, and enforces per-user AI budgets and task limits.

## Architecture

The application uses React and TypeScript for the frontend, a Rails GraphQL API for
authentication and domain data, and Python workers for asynchronous AI tasks.

Rails publishes tasks to an SQS queue. Python workers process them and return results
through a separate queue, while GraphQL subscriptions deliver updates to the frontend.
PostgreSQL stores application data and pgvector supports career library retrieval.
AI workflows use Pydantic AI, with tracing through Logfire.

| Directory | Purpose |
| --- | --- |
| `apps/web/` | React application with Apollo GraphQL client |
| `apps/landing/` | Marketing landing page |
| `services/api/` | Rails API, authentication, and domain services |
| `services/ai/` | Python workers, AI agents, and evaluations |
| `infra/` | Infrastructure configuration and local service emulators |
| `docs/` | Architecture and technical documentation |

## Getting started

Local development uses native Ubuntu with bash. Install Docker Engine and the Docker
Compose plugin, and make sure your user can run `docker` commands. Application runtimes
and dependencies run inside containers.

Run the commands below from the repository root (currently
`/home/jarrod/Desktop/resume_project`). Check Docker access with `docker info` and
Compose availability with `docker compose version` before starting the services.

1. Copy the environment templates:

   ```bash
   cp services/api/.env.example services/api/.env
   cp services/ai/.env.example services/ai/.env
   ```

2. Configure the environment files using the comments in each template. AI features use
   OpenAI credentials; user-text screening uses a TypeSafe API key. Set the optional `LOGFIRE_TOKEN` write token to enable remote tracing
   and eval reporting. Without it, startup remains noninteractive. Local database, queue, and storage connections are
   supplied by Docker Compose.

3. Build and start the services:

   ```bash
   docker compose up --build
   ```

   The API prepares the database on startup.

| Service | Local endpoint |
| --- | --- |
| Web application | http://localhost:5173 |
| Landing page | http://localhost:5174 |
| API | http://localhost:3000 |
| GraphQL subscriptions | ws://localhost:3000/cable |
| PostgreSQL | `localhost:5432` |
| ElasticMQ (SQS) | http://localhost:9324 |
| S3Mock | http://localhost:9090 |

The AI worker and API results worker consume queues and do not expose HTTP endpoints.

Run a model evaluation, for example retrieval or input screening:

```bash
docker compose run --rm ai python -m evals.run_library_retrieval_evals
docker compose run --rm ai python -m evals.run_user_text_screen_evals
docker compose run --rm ai python -m evals.run_prompt_guardrail_evals
```

Evaluations call external model APIs and incur usage charges; unit tests use test doubles.

## Development

Run commands from the repository root. Commands using `exec` require the relevant
container to be running; `run --rm` creates a temporary container.

| Task | Command |
| --- | --- |
| Start in the background | `docker compose up -d` |
| Stop services and retain database data | `docker compose down` |
| Follow service logs | `docker compose logs -f <service>` |
| Rebuild after dependency changes | `docker compose up --build -V` |
| Run API tests | `docker compose run --rm api bundle exec rspec` |
| Run AI worker tests | `docker compose run --rm ai pytest` |
| Run frontend tests | `docker compose exec web npm test` |
| Check frontend types | `docker compose exec web npm run typecheck` |
| Lint the frontend | `docker compose exec web npm run lint` |
| Run database migrations | `docker compose run --rm api bin/rails db:migrate` |
| Open the Rails console | `docker compose exec api bin/rails console` |
| Export the GraphQL schema | `docker compose run --rm api bin/rails graphql:schema:dump` |
| Generate frontend GraphQL types | `docker compose exec web npm run codegen` |

After GraphQL changes, export the schema and regenerate frontend types. Restart the
workers after changing code they load:

```bash
docker compose restart api-results-worker ai
```

To remove local database data and other named volumes, run `docker compose down -v`.

## Documentation

- [Architecture](docs/architecture.md) — service boundaries, data flow, and queue behavior.
- [Testing](docs/testing.md) — focused checks, isolated worktrees, and AI evals.
- [Repository conventions](AGENTS.md) — code organization and contribution guidelines.

Keep credentials in the ignored environment files. Commit environment templates without secrets.

### Local email inbox

Development verification and password-reset emails appear in [Letter Opener Web](http://localhost:3000/letter_opener),
inside the Rails app. Sign up or request a new email, then open the newest message
and click its link. No extra container or SMTP credentials are needed, and no
messages reach real inboxes. Emails are saved under `services/api/tmp/letter_opener`;
delete them from the inbox after testing.
