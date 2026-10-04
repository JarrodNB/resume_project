# AGENTS.md — services/ai/scrapers

## Purpose

Deterministic, site-specific job posting scrapers for the job boards people browse. Each
supported site turns a posting URL into a `JobPage` (title, company, location, description HTML)
from the site's own markup or data, never an LLM. Splitting the description into requirements
and nice-to-haves is site-independent and lives in `job_postings/`.

## Contents

- `job_page.py` — `JobPage`, `UnsupportedJobUrlError`, `JobPostingNotFoundError`,
  `JobPageUnreadableError`
- `job_site_registry.py` — `JOB_SITE_SCRAPERS`, `find_job_site_scraper(url)`
- `linkedin/` — LinkedIn guest job page scraper (see `linkedin/AGENTS.md`)

## Local Rules

- One site at a time, one subfolder per site. Register it in `JOB_SITE_SCRAPERS` and teach
  `Jobs::StartJobScrapingService` in Rails to recognise (and canonicalise) its job links.
- Prefer a site's public API or embedded structured data; fall back to stable class names.
- Raise `JobPageUnreadableError` when the page is missing the posting (login wall, new layout)
  rather than returning empty fields.
- Fetch with the injected `httpx.Client` (`TaskDependencies.http_client`) so tests can use
  `httpx.MockTransport`. Raise `JobPostingNotFoundError` for a missing posting; let other HTTP
  and network errors propagate (`worker/retryable_errors.py` decides on retries).
- Return the site's values unchanged apart from trimming and unescaping.
