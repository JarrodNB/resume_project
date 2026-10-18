# MVP Plan — AI Engineering Core

Goal: a working, deployable slice that shows real AI engineering (structured outputs,
human in the loop, memory, tracing, async workers), not a full job search platform.

Priority: this is a portfolio project for AI engineering roles first, and a possible
business second. When trade-offs come up, favor engineering quality and showcase value
over feature breadth or market positioning.

## In Scope

1. **Auth** — sign up / log in (Devise + JWT).
2. **Career library** — upload a PDF/DOCX (AI parses it into experiences, projects, education,
   skills, contact details, and summary) or fill out a form. The library is the base; there
   is no separate base resume to drift out of sync with it. Later, the AI helps rewrite library
   entries and asks the user when it needs facts (human in the loop).
3. **Job profiles** — paste a job URL; AI scrapes it into a structured profile
   (title, company, requirements, nice-to-haves). Manual entry as a fallback.
4. **Gap analysis** (done) — compare the career library to a job: a verdict (met, partly met,
   gap) for each requirement and nice-to-have, citing library entries as evidence.
   **Gap responses** (done): in the same view, the user can respond to any gap or partial match
   (e.g. "I used Kubernetes at Acme for two years"). Responses are saved per job and
   requirement, so they survive re-running the comparison. Checking "Add to career library"
   stores a library fact (the requirement plus the answer); only that fact is embedded and
   visible to the next comparison. No AI questions: the user writes what they want.
5. **Tailored resume** — generate a job-specific version from the career library, the gap
   analysis, and the user's gap responses; the user edits and approves it.
6. **Memory** — gap responses and facts are saved and reused in future tailoring.
7. **Job board** — saved jobs with stages: unapplied, applied, interviewing, rejected, offer.
8. **Export** — PDF export of a tailored resume.
9. **Observability** — every LLM call traced in Logfire.
10. **Evaluations** — a test set and scoring for each agent, so prompt and model changes are
    measured instead of guessed:

    | Agent           | What's measured                                                        |
    | --------------- | ---------------------------------------------------------------------- |
    | Resume parsing  | Extracted fields match hand-labeled resumes                            |
    | Job scraping    | Extracted requirements match hand-labeled job postings                 |
    | Gap analysis    | Finds the known gaps; verdicts and cited evidence match hand labels    |
    | Tailoring       | **Faithfulness**: no invented experience, skills, or numbers (the library and gap responses are the only sources); relevance to the job |

    Deterministic checks where possible, LLM-as-judge for subjective ones. Results are
    tracked in Logfire so runs can be compared over time.

## Out of Scope (Later)

DOCX export, job search sources, goals and reminder emails (Lambda), interview question
sets, contacts and follow-ups, profile and career pages, feed, company-side features,
employed-mode work journal.

## Build Order

1. **Local dev foundation** — install Docker Engine and the Docker Compose plugin on Ubuntu, root `docker-compose.yml`
   (Postgres + pgvector, ElasticMQ for SQS, api, ai worker, web, landing), a Dockerfile per
   app, and scaffold all four apps with their `AGENTS.md` files.
2. **Rails core** — auth, models (User, Resume, ResumeSection, Job, AiTask), GraphQL schema.
3. **Queue round trip** (done) — Rails publishes to `ai_tasks`, a Python worker echoes to
   `ai_results`, Rails consumes it and pushes the `aiTaskUpdated` subscription. Proves the
   pipeline end to end.
4. **AI features** — resume parsing, then job scraping, gap analysis
   (done), gap responses (done), tailoring, then memory. Each agent ships with its eval dataset; write the first few
   eval cases before tuning the prompt.
5. **Web app** — resume editor, job board, gap analysis chat, tailored resume view, PDF export.
6. **Landing page.**
7. **Deploy** — Terraform for AWS, k8s manifests, GitHub Actions CI/CD (including an eval
   run on changes to `services/ai`).

## Prerequisites to Install (Ubuntu)

Everything runs in Docker. The host setup needs:

- Docker Engine and the Docker Compose plugin, accessible to your user
- Git and a local checkout on the Ubuntu filesystem, opened directly in your editor

Use bash and run commands from the checkout root. See the root README for setup and
Docker access checks.

Ruby, Node, and Python run inside containers; generators like `rails new` also run
through Docker. Terraform, kubectl, and AWS CLI can run from containers later too.

## Open Questions

- Product name is Careergrind. The web app and the AI worker each keep it in one module
  (`apps/web/src/lib/productName.ts`, `services/ai/worker/product_name.py`). Check that the
  name is available before any public launch.
