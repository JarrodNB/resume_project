<!-- Description: Running and interpreting optional AI evaluation reports.
Index: commands, supported suites, comparison configuration, costs, artifacts and failures. -->

# Evaluation reports

Run any existing eval and save a readable Markdown report to this directory:

```bash
docker compose run --rm --no-deps ai python -m evals.run_report resume_parsing
```

Use the configured defaults, select one model, or repeat `--model` for two-model comparison:

```bash
docker compose run --rm --no-deps ai python -m evals.run_report interview_questions --model openai:gpt-5-mini --model openai:gpt-5
docker compose run --rm --no-deps ai python -m evals.run_report library_retrieval --model openai:text-embedding-3-small --model openai:text-embedding-3-large
docker compose run --rm --no-deps ai python -m evals.run_report user_text_screen --model typesafe:jev-1.13.0
```

Supported suites: `resume_parsing`, `job_posting_parse`, `job_posting_extraction`,
`gap_analysis`, `tailoring`, `interview_questions`, `interview_feedback`,
`library_retrieval`, `user_text_screen`, and `prompt_guardrail`. Run `--help` for options.
Standalone runner commands retain their defaults and terminal reports.

Explicit generative overrides use OpenAI models and disable fallback for that run, so the
comparison measures the selected model. Production settings are unchanged. Reasoning effort,
limits, prompts, screening, fixtures and Logfire tracing remain configured as before.
Interview quality judges use the evaluated model; their configuration and reasons appear in
reports. Retrieval overrides require OpenAI embedding models and retain configured dimensions.
Screening overrides require Typesafe Jev decision models. The prompt guardrail suite uses a
fixed fake generator and the configured live Jev model; it rejects model overrides.

Reports align identical case names in score and raw-output/reason tables, with model labels,
configuration, aggregates, task/total durations, assertions and detailed failure traces.
Names contain UTC timestamps and random identifiers; repeated runs never overwrite artifacts.
The Docker bind mount persists `/docs/evals` to this host directory. `--output-dir` changes
the container destination; use a bind-mounted location to retain reports after container exit.

Task/evaluator errors produce a saved report and nonzero exit status, including all-case
failure runs. Low subjective scores are review signals, not new pass gates. The prompt
guardrail's existing decision gate remains in force. Inspect local reports before committing
or sharing them: full synthetic inputs and outputs are included.
Live eval runs call paid providers and require the usual configured credentials.

Reports include estimated USD costs for the whole run and each aligned case, plus
per-provider-model input, cached input and output tokens. The total includes captured
generation, Jev screening, LLM judges, embeddings and validation retries, even if a later
step fails. Cached input is part of the input count; its discounted rate is applied once.
Fake models are excluded. Prices come from `services/ai/worker/model_prices.py`, using
standard rates and rounding up to a microdollar per request. These are estimates, not invoices.

Unknown prices or missing provider token usage produce an **incomplete known subtotal**.
No captured provider calls means **unavailable**, never an assumed free run. Provider
errors may incur charges without returning usage; those calls remain unknown. Capture
uses synchronous native request spans and requires recording instrumentation; sampling
or disabled instrumentation can omit calls. Whole-run costs include calls outside a case.
Differing configured fallback models also make the estimate incomplete: the SDK can hide
failed intermediate attempts within one request span. Explicit `--model` disables fallback.
Case estimates include tasks and their evaluators. Existing reports have no retrospective
costs: rerun the optional CLI to capture usage. Standalone runners and production billing
retain their existing behavior.
