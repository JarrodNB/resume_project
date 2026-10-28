# AI safety and usage

Shared controls for provider calls, user text, telemetry, and spending. Attempt-report fields are defined in [AI tasks](ai-tasks.md#queue-messages).

[Architecture overview](../architecture.md) · [AI tasks](ai-tasks.md) · [Interview prep](interview-prep.md) · [AI safety and usage](ai-safety-and-usage.md) · [Career library](career-library.md)

## Usage Limits

LLM calls cost money, so each user has limits, checked by `AiUsage::CheckAiTaskAllowanceService`
before a task is queued (under a lock on the user row, so concurrent requests can't both pass).
General AI limits exclude spoken interview preparation, turns and speech:

- **Monthly budget** (fallback $3.00, `AI_MONTHLY_BUDGET_USD`): known general AI task costs plus
  background embedding request costs created this calendar month (UTC). The worker estimates each request's cost from its
  token usage and a per-model price table (`services/ai/llm/model_prices.py`) and reports it
  with attempt reports, including unsuccessful attempts. Missing provider usage or prices
  makes accounting incomplete; unknown costs do not block tasks below their known-spend budget.
- **Tasks per hour** (fallback 30, `AI_TASKS_PER_HOUR`): tasks created in the last rolling hour.
- **Tasks in flight** (fallback 3, `AI_MAX_IN_FLIGHT_TASKS`): `queued` tasks from the last 15
  minutes (older ones are treated as stuck). Tasks waiting on the user's answer don't count.

Nullable columns on `users` override each general AI default. The existing API `.env.example`
explicitly configures $2/month, 10 tasks/hour and two in-flight tasks; those example values
are overrides of the fallback defaults above, and are unchanged. The existing `me { aiUsage }` query exposes
combined known monthly spend across general AI and every spoken interview stage, with the
sum of both monthly allowances as its budget. Admission checks explicitly select their own
general or interview allowance; combined reporting does not merge those limits.
The API also exposes `incompleteAttempts` and `accountingComplete`, so consumers can distinguish
known subtotals from complete recorded usage. No spend display or usage subscription is added.
See [cost accounting and verified receipt reconciliation](ai-cost-accounting.md).

Spoken interviews have an independent per-user allowance: $3/month
(`INTERVIEW_MONTHLY_BUDGET_USD`), 30 session starts/hour (`INTERVIEW_SESSIONS_PER_HOUR`), and
three concurrent operations (`INTERVIEW_MAX_IN_FLIGHT_OPERATIONS`). General tasks and general
per-user overrides do not consume or change those allowances. Written interview question
practice remains general AI. Every spoken stage still has its own durable cost and unknown
usage records; only its session's hourly admission is shared. Legacy fixture operations also
use the interview bucket, retaining their existing individual hourly admissions. See
[spoken session accounting](interview-sessions.md#http-execution-accounting). The retained
paid verification database has an additional global allowance/unknown-receipt stop independent
of both per-user buckets; separating allowances does not clear that stop.

The real browser-QA overlay opts into `INTERVIEW_LOCAL_TESTING_UNMETERED=true`. Only
development honors this mode: spoken-interview monthly/hourly and verification spend/unknown
gates are skipped, while cost records, concurrency, execution limits and all general AI
admission stay intact. It does not forgive, erase or assign zero to unknown costs.

Separately, Rack::Attack throttles requests (`config/initializers/rack_attack.rb`): sign-in by
IP and by email, sign-up and session bootstrap by IP, and `/graphql` by persisted-session user and by IP. Throttled
requests get a JSON 429 with `Retry-After`.

## Decisions

- **OpenAI** as the LLM provider. Generative agents (parsing, sorting, gap analysis, tailoring,
  interview questions, and interview feedback) default to `gpt-6-luna` with reasoning
  disabled and fall back to `gpt-5-nano` on a rate limit, 5xx, or connection error.
  A failed output check retries the same model. General text screening selects Jev,
  local Llama Prompt Guard, or a configurable LLM as primary and fallback. Spoken interview
  preparation and dialogue default to disabled Luna reasoning. Set
  `INTERVIEW_PREPARATION_THINKING` and `INTERVIEW_DIALOGUE_THINKING` independently
  to `false`, `true`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
  Root Compose reads these from the root `.env` or shell; the retained QA launcher
  reads them from its configured AI environment file. Recreate the interview runtime
  after changing them; these settings do not affect queued agents.
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
  Screening has bounded concurrency; at most three independent section
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

- **User-written text is screened before it enters a prompt.**
  `USER_TEXT_SCREEN_MODEL` and `USER_TEXT_SCREEN_FALLBACK_MODEL` each select Jev
  (`typesafe:jev-1.13.0`), local Llama Prompt Guard
  (`meta-llama/Llama-Prompt-Guard-2-22M`), or `llm`. The `llm` choice resolves through
  `USER_TEXT_SCREEN_LLM_MODEL`, which defaults to `openai:gpt-5-nano` and must have a known
  price. `USER_TEXT_SCREEN_TIMEOUT_SECONDS` limits one input's primary and fallback work.
  All three choices judge prompt injection only. Jev answers one yes/no question about
  attempts to override, reveal, or ignore instructions; code blocks when its yes-confidence
  reaches 0.7. Each Jev call has a three-second cap within the remaining deadline. Local
  Llama splits long inputs into overlapping token-bounded chunks and classifies up to four
  concurrently. The LLM returns one strict boolean and no Jev confidence margin.
  A block does not trigger fallback. An attempted failure uses the selected fallback
  within the remaining deadline; choosing the same option twice disables recovery.
  Missing Jev credentials prevent a Jev call. Exhausted time or failed recovery leaves
  the input unchecked. Usage caps and external cancellation propagate. Screening models
  are exempt from recursive input screening. The scoped spoken-interview runtime keeps
  its fixed Jev primary and Nano fallback for its separate provider accounting.
  A short phrase check blocks obvious instruction-override wording without a model call. The
  screening unit is a cohesive untrusted source item: document, job context, library entry,
  gap response, submitted answer, selected section snapshot, or reused interview question. Each is
  checked once per execution, except saved Job, gap-response, written-practice and career-library fields whose successful checks
  persist in Rails. Features screen only unchecked fields they use; edits clear the changed
  field names. Existing/imported rows start unchecked. A blocked or unchecked optional entry
  is left out with a warning; a required input prevents generation. Imported, manually edited, retrieved, and
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
  execution's prompt coverage; later deliveries start fresh prompt coverage. Saved library
  field checks rebuild exact source coverage from the database snapshot. Final queue results
  report successful field names even when generation fails. Rejected or unavailable checks
  remain unchecked. These approvals have no expiry or policy version. Text over a shared
  character cap is rejected before it is stored and again before a screening or generative call (`TextLimits` in Rails,
  `services/ai/text_limits.py` in the worker): a resume extract over 80,000 characters or 30
  PDF pages, one screened string over 80,000 characters, or an assembled prompt over 120,000
  characters. Those failures tell the user the text is too long. They are not reported as
  unsafe, and rows are not silently truncated. A posting with too many bullets to sort is
  still saved, with a warning to add requirements by hand. A request body over 8 MB is a
  JSON 413. Provider screening usage is reported under its actual model and counts
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
  Exact charges for such attempts require verified provider receipts. The operator-only
  `ai_usage:reconcile` import dry-runs by default, retains prior evidence, and applies each
  verified replacement once. It cannot infer missing user-level charges from account-wide invoices.
  `ai_usage_attempts` records each execution independently of task outcome.
  Under the task lock, final reports add known totals once, including retries and late or
  out-of-order reports. Finished tasks keep their outcome. Legacy messages without an
  attempt identity assign totals only when their outcome can still apply. Monthly totals still use
  tasks created in the UTC calendar month; unknown costs flag incomplete accounting and do
  not independently block work. The existing hourly and in-flight caps remain in place.
  Deploy the Rails migration/consumer before the new worker message format. This accounting
  covers queued AI tasks and their query embeddings. Independent Rails career-library/interview
  Q&A embedding batches retain separate durable receipts included in general/combined spend;
  paid eval runs retain their separate execution paths. Queued Luna uses standard service and
  a fixed 30-minute cache lifetime; writes are priced separately. Old Luna receipts without
  cache-write counts are flagged incomplete without changing their known totals.

- **Rack::Attack on Rails.cache for request throttling.** No Redis: the dev memory store and
  production Solid Cache are enough at this scale.
