# AI safety and usage

Shared controls for provider calls, user text, telemetry, and spending. Attempt-report fields are defined in [AI tasks](ai-tasks.md#queue-messages).

[Architecture overview](../architecture.md) · [AI tasks](ai-tasks.md) · [Interview prep](interview-prep.md) · [AI safety and usage](ai-safety-and-usage.md) · [Career library](career-library.md)

## Usage Limits

LLM calls cost money, so each user has limits, checked by `AiUsage::CheckAiTaskAllowanceService`
before a task is queued (under a lock on the user row, so concurrent requests can't both pass):

- **Monthly budget** (default $2.00, `AI_MONTHLY_BUDGET_USD`): the sum of `ai_tasks.cost_microdollars`
  for tasks created this calendar month (UTC). The worker estimates each request's cost from its
  token usage and a per-model price table (`services/ai/worker/model_prices.py`) and reports it
  with attempt reports, including unsuccessful attempts. Missing provider usage or prices
  makes accounting incomplete; unknown costs do not block tasks below their known-spend budget.
- **Tasks per hour** (default 10, `AI_TASKS_PER_HOUR`): tasks created in the last rolling hour.
- **Tasks in flight** (default 2, `AI_MAX_IN_FLIGHT_TASKS`): `queued` tasks from the last 15
  minutes (older ones are treated as stuck). Tasks waiting on the user's answer don't count.

Nullable columns on `users` override each default. The existing `me { aiUsage }` query exposes
known monthly spend. The backend monthly summary also retains the incomplete-attempt count;
no new user-facing spend display or usage subscription is added.

Separately, Rack::Attack throttles requests (`config/initializers/rack_attack.rb`): sign-in by
IP and by email, sign-up by IP, and `/graphql` by user (JWT `sub`) and by IP. Throttled
requests get a JSON 429 with `Retry-After`.

## Decisions

- **OpenAI** as the LLM provider. Generative agents (parsing, sorting, gap analysis, tailoring,
  interview questions, and interview feedback) default to `gpt-6-luna` with low reasoning
  effort and fall back to `gpt-5-nano` on a rate limit, 5xx, or connection error.
  A failed output check retries the same model. JEV stays the pinned primary safety model;
  its separate Nano classifier handles attempted screening failures.
  Luna was selected for its lower cost and latency in the October 2026 synthetic evaluations.
  Quality varies between runs, and interview quality scores were lower than GPT-5 mini's;
  this is a cost and latency preference rather than a claim of better quality on every task.

- **Prompt versions are stamped on traces.** Each prompt module has a version constant. The
  agent run records it on the Logfire spans for that call, so a task that screens text and
  then generates still shows which prompt produced which call. `LOGFIRE_ENVIRONMENT`
  labels the trace with the environment.

- **An agent run stops at a modest cap, and the task fails.** Each run allows 6 model requests
  (the first answer, two output-validator retries, and the same three after a switch to the
  fallback model), no tool calls, 64,000 output tokens, and 128,000 total tokens. The library
  default of 50 requests is a loop these agents never need. There are no tools yet, so a tool
  call fails the run until one is registered and the cap is raised. Reasoning tokens count as
  output. The token caps are checked after the response, so one over-limit response is billed
  once and the task is not retried. A hit raises `UsageLimitExceeded`. The worker publishes
  `failed` on the first attempt, with no partial resume, analysis, or section. A wall-clock
  timeout stays retryable, because the same run may finish next time. A cap on the Jev screen
  fails the task the same way. Screening outages omit text only when recovery also fails.
  Complete-draft tailoring shares one deadline across preparation and all writers.
  Screening and retrieval have bounded concurrency; at most three independent section
  writers run together. A failure cancels and awaits outstanding requests before reporting
  an outcome. Received responses remain billable; cancelled requests without usage mark
  the attempt incomplete.

- **Evals for every agent.** Pydantic Evals defines the test cases and evaluators and runs
  them locally and in CI. Scores go to Logfire for comparison across prompt and model
  versions. Faithfulness (no invented experience) is the top metric, because it's the
  product's core promise.

- **Logfire telemetry configured through environment variables.** `LOGFIRE_TOKEN` enables
  remote export; without a token the worker and evals run without remote tracing or login.
  `LOGFIRE_ENVIRONMENT` labels environments. Each task and eval run flushes in a `finally`
  block with a five-second total caller wait. One daemon flush runs at a time, with no
  queued attempts if an exporter stalls. Task privacy is captured at span creation and masked
  synchronously before export, including attributes, events, exception text, and status.
  Model requests and search queries use contact placeholders; application responses restore
  contact values. Imports attach detected contact to the same object before their first
  screen; it remains active through exception logging and parent span completion.
  Import spans omit task input metadata before detection because filenames can contain PII.
  Concrete request transcripts contain masked requests. Other resume content and missed
  contact can still leave the app when remote export is enabled.

- **User-written text is screened before it enters a prompt.** A small Jev decision model
  (`typesafe:jev-1.13.0`, TypeSafe) answers two yes/no questions: does the text try to override,
  reveal, or ignore instructions, and does it ask for actionable help with harm, crime, or
  abuse. Ordinary career history is not harmful. Code blocks when either answer's yes-confidence
  is at least 0.7. Each JEV run has an application-enforced three-second cap, shortened by
  the remaining source/task deadline. An attempted provider error, timeout, or invalid response
  invokes a separate safety classifier (`USER_TEXT_SCREEN_FALLBACK_MODEL`, default
  `openai:gpt-5-nano`) on the same protected chunk. Its versioned instructions treat the
  message as data; structured boolean answers block when either question is positive.
  No confidence margins are invented for Nano. A JEV rejection never invokes fallback.
  Missing `TYPESAFE_API_KEY` calls neither provider. Exhausted time or a failed fallback
  leaves the input unchecked. Usage caps and external cancellation propagate without recovery.
  Each new chunk starts with JEV; there is no execution-wide circuit breaker. Both classifiers
  are exempt from recursive input screening. Fallback shares the remaining overall deadline.
  A short phrase check blocks obvious instruction-override wording without a model call. The
  screening unit is a cohesive untrusted source item: document, job context, library entry,
  gap response, submitted answer, selected section snapshot, or reused interview question. Each is
  checked on first AI use. Saved records carry nullable `screened_at` and
  `screening_policy_version` fields; unchanged records approved under the current policy
  skip provider screening. Temporary or unproven sources remain checked per execution.
  A blocked or unchecked optional entry is left out with a
  warning; a required input prevents generation. Imported, manually edited, retrieved, and
  scraped content follow this same rule when used in a generative request.
  Large sources use 4,000-character chunks with 300 characters of overlap by default.
  A live synthetic comparison of 2,000, 4,000, and whole resumes found identical decisions
  across 14 documents; 4,000 required 25 calls versus 48 for 2,000. This supports the lower
  request count, not a claim of better detection than whole resumes. The 2,000 setting
  remains available for repeat evaluation. Boundary overlap is intentional repeated text, not a
  second screening pass. All chunks must pass; a late rejection discards the entire item.
  Trusted builders bind exact assembled prompts to screened sources. Every generative
  agent retains an official input capability: it checks unknown direct input and user/tool
  history without screening an already covered prompt again. Coverage never uses substring
  removal or a caller boolean. Output-validation retries and provider fallback reuse the
  execution's coverage. Trusted database snapshots keep record metadata outside prompt JSON,
  and full record screening includes experience highlights and complete job requirements,
  responsibilities and nice-to-haves even when generation uses a narrower projection.
  Builders reconstruct prompt values exclusively from checked sources; record state never
  approves an arbitrary caller string. Local length and phrase checks precede reuse.

  Workers return completed successes through `screening_successes`, including successes
  before a later failure or retry. Rails atomically checks owner and observed `updated_at`
  before setting the two fields. Relevant domain edits clear them; highlight changes also
  advance the experience version. Unrelated ordering, stage or feedback changes retain
  approval, though they may conservatively prevent an in-flight report from saving.
  Deleted and edited records cannot be approved by old reports. Rejections, unavailable
  checks and incomplete chunk passes produce no success report. Upload approval never
  transfers to extracted records. Concurrent first uses can both screen before Rails saves
  a report; this does not guarantee one provider request globally.

  The explicit policy version must change with classifier instructions, thresholds or
  local rules. Its effective token includes the configured primary/fallback models, chunk
  size and current known-contact masking identity, so changed protected text cannot inherit
  an approval from older masking. Deploy additive fields, grants and Rails result support
  before new workers. Rolling back workers leaves harmless nullable state fields.
  Text over a shared character cap is rejected before
  it is stored and again before a Jev or generative call (`TextLimits` in Rails,
  `services/ai/text_limits.py` in the worker): a resume extract over 80,000 characters or 30
  PDF pages, one screened string over 80,000 characters, or an assembled prompt over 120,000
  characters. Those failures tell the user the text is too long. They are not reported as
  unsafe, and rows are not silently truncated. A posting with too many bullets to sort is
  still saved, with a warning to add requirements by hand. A request body over 8 MB is a
  JSON 413. JEV and fallback usage are reported under their actual models and count
  toward the monthly budget, including completed responses before later failures and validation
  retries. Missing usage stays explicitly unknown. JEV token rates are TypeSafe's published
  $0.042 per 1M input tokens (output free), from https://docs.typesafe.ai/models (checked 2026-10-05).

- **AI budget uses known costs, including unsuccessful attempts.** The worker collects
  screening, generation and query-embedding responses at their request seam, before output
  validation, run limits or later failures can discard usage. Each concrete fallback model
  is observed separately. Accounting does not depend on telemetry export. Costs use the
  worker's local price table and integer micro-dollars; provider charges without usage or
  pricing stay unknown rather than being estimated as zero. An unfinished report is sent
  before execution, so a stopped worker or failed final publication leaves an unknown marker.
  Exact charges for such attempts require provider reconciliation, which is not automated.
  `ai_usage_attempts` records each execution independently of task outcome.
  Under the task lock, final reports add known totals once, including retries and late or
  out-of-order reports. Finished tasks keep their outcome. Legacy messages without an
  attempt identity assign totals only when their outcome can still apply. Monthly totals still use
  tasks created in the UTC calendar month; unknown costs flag incomplete accounting and do
  not independently block work. The existing hourly and in-flight caps remain in place.
  Deploy the Rails migration/consumer before the new worker message format. This accounting
  covers queued AI tasks and their query embeddings; independent Rails career-library/interview Q&A
  embedding syncs and paid eval runs retain their separate existing execution paths.

- **Rack::Attack on Rails.cache for request throttling.** No Redis: the dev memory store and
  production Solid Cache are enough at this scale.
