# CleanJobData API research

Research date: 2026-10-19. This note uses CleanJobData's own API documentation, pricing page, and terms. No API key, live API calls, inventory benchmark, or legal review was performed. Provider claims about coverage, normalization, and freshness have not been independently measured.

## Assessment

CleanJobData is a technically suitable candidate for a future **job discovery/catalogue** feature: it exposes filtered listings, descriptions, cursor pagination, and a separate endpoint for incremental updates and closures. It does not directly fit the current flow for importing a job the user already chose. Careergrind currently saves user-owned `Job` records from a pasted posting or a single supported LinkedIn URL, then uses them for gap analysis and tailoring. A provider-backed catalogue would need a product and persistence design before its records are fed into those workflows. [Career library and job workflow](../architecture/career-library.md#decisions), [AI task contracts](../architecture/ai-tasks.md#queue-messages)

## Authentication and base URL

The REST base URL is `https://api.cleanjobdata.com`. Send the account API key in `Authorization: Bearer YOUR_API_KEY`; the official expired-jobs example demonstrates this header, and the error guide specifies that a missing or invalid Authorization key yields `401`. The public docs direct developers to get a key through the account/trial flow; protect it as a server secret, never expose it to the browser. [Expired jobs example](https://cleanjobdata.com/docs/api/jobs/expired), [Errors](https://cleanjobdata.com/docs/api/errors), [Pricing / start trial](https://cleanjobdata.com/pricing)

## Endpoints

| Endpoint | Purpose and response | Notes |
| --- | --- | --- |
| `GET /jobs` | Filtered list; JSON envelope `{ data: Job[], pagination, meta }`. | Defaults to active jobs and summary fields; full description is excluded unless requested. [Reference](https://cleanjobdata.com/docs/api/jobs) |
| `GET /jobs/:id` | One job object (not a `data` envelope), including full description. | Numeric CleanJobData ID; detail calls count against plan quota. [Reference](https://cleanjobdata.com/docs/api/jobs/by-id), [pricing FAQ](https://cleanjobdata.com/pricing) |
| `GET /jobs/expired` | `{ data: [{id, expired_at}], pagination: {limit, next_cursor} }`. | IDs closed during a rolling window, newest expiry first; CleanJobData key required, not in its RapidAPI listing. [Reference](https://cleanjobdata.com/docs/api/jobs/expired) |
| `GET /jobs/:id/apply` | Unlocks a direct application URL on the Solo MCP plan. | Solo MCP is personal-use oriented; its plan documentation should not be treated as the suitable Careergrind tier. [Jobs reference](https://cleanjobdata.com/docs/api/jobs), [Pricing](https://cleanjobdata.com/pricing) |

The Jobs API also points to Geo Suggest for resolving location IDs, and Companies endpoints for company lookups. Trial includes full job data access; Starter and Pro explicitly include Geo Suggest. [Jobs reference](https://cleanjobdata.com/docs/api/jobs), [Pricing](https://cleanjobdata.com/pricing)

### List filters and fields

Useful documented query parameters:

| Parameter | Meaning |
| --- | --- |
| `title` / `search` | Full-text job-title/keyword search; `search` aliases `title`. |
| `location` | Comma-separated ISO 3166-1 alpha-2 country codes when no geo IDs are passed (e.g. `US,CA`). |
| `country_id`, `state_id`, `city_id` | Comma-separated numeric IDs; the docs recommend Geo Suggest to obtain exact IDs. |
| `remote=true` | Remote-only (`true` must be the exact value). `remote_type` may be `fully_remote`, `remote_country`, `remote_region`, or `hybrid`. |
| `company_name`, `employer_id`, `company_website_url`, `domain` | Company filters. `domain` matches the application URL domain, which can be an ATS domain; use company website URL for employer scoping. |
| `employment_type`, `experience_level` | Enumerated filters. Employment values include full-time, part-time, contract, intern and others; levels are `EN`, `MI`, `SE`, `EX`. |
| `salary`, `require_salary` | Salary lower bound or `min,max`; `require_salary=true` excludes jobs without verified salary. |
| `max_age` / `published_after` | Rolling or fixed cutoff on employer-published date. If `published_after` is set, `max_age` is ignored. |
| `created_max_age` | Rolling cutoff on CleanJobData ingestion time; recommended by provider for incremental synchronization. |
| `limit` | Per-page result cap; default 20, maximum determined by plan. Over-limit requests are clamped silently. |
| `fields`, `extra_fields`, `exclude_fields` | Select response fields. Default omits description; use `extra_fields=description` to add it. `fields` replaces defaults and takes precedence over extra/exclude fields. |
| `include_expired=true` | Include inactive records in the list response. |
| `count=true` | Add matching total to pagination; costs an extra query, according to the docs. |

The complete allowed field set and parameter semantics are in the [Jobs API reference](https://cleanjobdata.com/docs/api/jobs). A representative request is:

```sh
curl --get 'https://api.cleanjobdata.com/jobs' \
  --data-urlencode 'title=software engineer' \
  --data-urlencode 'location=US,CA' \
  --data-urlencode 'remote=true' \
  --data-urlencode 'created_max_age=2h' \
  --data-urlencode 'limit=20' \
  --data-urlencode 'extra_fields=description' \
  -H "Authorization: Bearer $CLEANJOBDATA_API_KEY"
```

The list response contains `data`, `pagination` and `meta`. A job includes numeric `id`, `title`, `published`, nullable `location`, `locations`, nullable HTML `description`, `application_url`, activity and remote flags, employment and experience categories, salary fields, nullable `company` details, and `employer_id`. Treat optional company/location fields and description as nullable; the provider notes that the description may be null. The `application_url` is a CleanJobData redirect on Trial and a direct employer URL on Starter/Pro/Enterprise. [Jobs response schema](https://cleanjobdata.com/docs/api/jobs), [pricing](https://cleanjobdata.com/pricing)

### Pagination and synchronization

List pagination is cursor-based, not page-number-based. Keep the same filters and `sort_by` while traversing one result set. Pass `pagination.next_page` back as `cursor` (the aliases `cursor`, `next_page`, and `prev_page` accept the opaque token); stop when `next_page` is null or absent. Do not construct/reuse cursors for another filtered query. [Jobs reference](https://cleanjobdata.com/docs/api/jobs), [sync guide](https://cleanjobdata.com/guides/syncing-job-data-in-depth)

For a first load, page through the desired bounded catalogue slice and upsert by CleanJobData `id`. On scheduled runs, use an overlapping `created_max_age` window because `published` tracks the employer date, not ingestion, and the API does not return the ingestion timestamp as a field. Dedupe by provider ID to make overlap safe. Separately poll `/jobs/expired` with a window covering time since the last successful run and mark or remove matching local records. The provider says duplicate postings across ATS platforms are deduplicated upstream, but local upsert by provider ID is still needed. [Sync guide](https://cleanjobdata.com/guides/syncing-job-data-in-depth), [expired endpoint](https://cleanjobdata.com/docs/api/jobs/expired)

```sh
# Incremental additions; use a window wider than the scheduler interval.
curl --get 'https://api.cleanjobdata.com/jobs' \
  --data-urlencode 'created_max_age=2h' \
  --data-urlencode 'limit=20' \
  -H "Authorization: Bearer $CLEANJOBDATA_API_KEY"

# Closures since the previous run; continue with cursor=next_cursor as needed.
curl --get 'https://api.cleanjobdata.com/jobs/expired' \
  --data-urlencode 'max_age=2h' \
  --data-urlencode 'limit=1000' \
  -H "Authorization: Bearer $CLEANJOBDATA_API_KEY"
```

## Rate limits, quotas, and errors

Current published plans:

| Plan | Published price and request quota | Maximum list size | Application URL |
| --- | --- | --- | --- |
| Trial | $0; quota is inconsistent across official pages (see below) | 20 | CleanJobData redirect |
| Starter | $97/month; 50,000 requests/month | 50 | Direct employer URL |
| Pro | $297/month; 200,000 requests/month | 100 | Direct employer URL |
| Enterprise | Custom; unlimited API requests and daily NDJSON dumps | Custom | Direct employer URL |

Official CleanJobData pages currently disagree on the Trial quota: the [pricing page](https://cleanjobdata.com/pricing) lists 250 list requests and 500 detail requests per month, while the [quickstart](https://cleanjobdata.com/guides/job-search-api-quickstart) and [homepage](https://cleanjobdata.com/) advertise 300 requests per day. Confirm the account's actual quota with CleanJobData before estimating a prototype or production budget. The pricing page lists Starter and Pro monthly request quotas and plan page sizes, but the API also enforces per-second limits. Use response headers to pace calls and confirm plan-specific caps at implementation time. Job list/detail/expired calls consume plan quota; Geo Suggest and Companies have separate per-second limits. Published plan details can change. [Pricing](https://cleanjobdata.com/pricing), [rate limits](https://cleanjobdata.com/docs/api/errors)

Errors use `{"error":"..."}`. Documented statuses: `400` invalid input, `401` failed authentication, `404` unknown resource, `429` rate limit/quota, `500` provider error. A per-second `429` and exhausted plan quota both use 429 but require different handling: short wait (about 1–2 seconds) and retry for the former; stop and surface the quota condition for the latter. Successful responses and per-second 429s include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Type` (`list`, `detail`, or `geo`); monthly quota is not exposed in those headers. There is no `Retry-After` header. [Errors](https://cleanjobdata.com/docs/api/errors), [sync guide](https://cleanjobdata.com/guides/syncing-job-data-in-depth)

Implementation should pace requests from the headers, distinguish the two 429 message forms, and bound retries for transient provider/network/5xx failures. Never loop-retry an exhausted quota. The docs do not publish a general SLA or retry policy for 5xx responses. [Errors](https://cleanjobdata.com/docs/api/errors)

## Plans and data-use terms

The current terms permit Starter and Pro customers to sync API data to their own database and power their own end-user product, including a public job board. They prohibit raw-listing redistribution through a separate API, feed, or export without an Enterprise Commercial Licence. The terms also say that commercially reselling ingestion into LLMs, public AI agent workflows, or mass-market search indexes requires Enterprise. This matters if Careergrind uses these listings as inputs to generative workflows: the public wording may cover more than simply operating an API-facing agent, so confirm the intended product flow and licence with the provider before commercial launch. Trial is marketed as a product-validation plan, but it is not named in the Terms' section 3 permitted-use grant; clarify terms if relying on Trial beyond evaluation. [Terms, sections 3–5](https://cleanjobdata.com/terms), [Pricing](https://cleanjobdata.com/pricing)

## Fit with Careergrind's architecture

Careergrind's existing `Job` is an owner-scoped saved job, associated with the user's application stage, notes, gap analysis, and tailored resumes. Its creation flows save user-selected LinkedIn URLs or pasted postings; a scraped posting is immediately saved as a user's Job after the queued task result is applied. [Career library and job workflow](../architecture/career-library.md#decisions), [Job model](../../services/api/app/models/job.rb), [job service guidance](../../services/api/app/services/AGENTS.md)

Therefore, treat discovery ingestion as a separate provider catalogue/import boundary rather than creating one user-owned `Job` for every fetched listing. A later user action could import or attach a listing to their own job workflow; that design needs explicit choices about ownership, duplicate handling, stale/expired records, and what data is copied. Candidate persistence should retain the provider's numeric ID, source/provider, original employer application URL, retrieval time, and active/expiry state so sync is idempotent and listing state can be refreshed. This is an implementation recommendation inferred from the current domain model and the provider's sync contract, not an existing architecture decision.

The API call is network I/O and should not run in a GraphQL request. The project routes long-running work through SQS and keeps Rails as the domain-data owner; Python workers have read-only DB access and return work via `ai_results`. A scheduled catalogue sync would need an explicit owner and queue/job design: if Rails owns the catalogue it must perform its own writes; don't add catalogue writes to the existing AI reader. Provider ingestion is deterministic API integration, not an LLM task, so AI per-user task accounting and resume/job scraping schemas should not be repurposed. [Architecture overview](../architecture.md), [AI task architecture](../architecture/ai-tasks.md)

If CleanJobData descriptions are used for gap analysis or tailoring, preserve the source HTML/text and canonical application URL appropriately, convert descriptions to bounded plain text for the existing worker contracts, and handle missing descriptions explicitly. The existing `ScrapedJobPosting` schema expects requirements, responsibilities, and nice-to-haves as verbatim text extracted from a user-selected posting; the API's normalized job object does not provide those split lists. Reuse the current source-faithful extraction path only after establishing a user-initiated import and the relevant plan terms. [Scraped job schema](../../services/ai/schemas/scraped_job_posting.py), [AI task contracts](../architecture/ai-tasks.md#queue-messages), [Terms](https://cleanjobdata.com/terms)

## Open checks before implementation

- Select target countries and role filters; no live inventory or Philippines coverage check was run.
- Confirm Trial use rights and the Enterprise clause for the exact Careergrind AI workflow.
- Decide catalogue versus user-owned `Job` boundaries and whether listing snapshots/description are retained.
- Measure description completeness, stale/closed rate, location quality, and duplicates on representative roles.
- Recheck quotas, plan pricing, API shape, and per-second limits when implementation begins.
