# AGENTS.md — services/ai/scrapers

## Purpose

Public job-page acquisition: retain the LinkedIn guest adapter and use a generic public
fetcher for other sites. One embedded JobPosting supplies metadata where available; otherwise
selected visible main/article content reaches the source-checked parser. No script execution,
login, crawling or linked-resource fetching. Structured job construction lives in `job_postings/`.

## Contents

- `job_page.py` — `JobPage`, `UnsupportedJobUrlError`, `JobPostingNotFoundError`,
  `JobPageUnreadableError`
- `job_site_registry.py` — `JOB_SITE_SCRAPERS`, `find_job_site_scraper(url)`
- `linkedin/` — LinkedIn guest job page scraper (see `linkedin/AGENTS.md`)

## Local Rules

- Site-specific adapters are optional optimizations registered ahead of the generic fallback.
  General HTTP(S) posting URLs do not require another registered site.
- `public_job_url.py` validates URL forms and all DNS answers; the fetcher connects to a
  validated literal public IP for every hop, never a second origin-host DNS lookup. Keep
  redirects bounded, special/private IPv4/IPv6 blocked, and standard ports only.
- `public_job_transport.py` delegates through fresh environment-aware clients, preserving
  proxy/CA policy and original-host TLS verification even through a proxy CONNECT tunnel.
  The outer client's trust_env=False routes into that delegate, not around the proxy.
  Never forward application headers, authorization or cookies.
- `fetch_public_job.py` bounds DNS time, redirect count, bytes and elapsed response budget.
  `public_job_page.py` rejects multiple job objects/login forms and selects metadata or main
  content. Raw pages have non-authoritative metadata: the parser must identify one actual job.
- Prefer a site's public API or embedded structured data; fall back to stable class names.
- Raise `JobPageUnreadableError` when the page is missing the posting (login wall, new layout)
  rather than returning empty fields.
- Fetch with the injected `httpx.Client` (`TaskDependencies.http_client`) so tests can use
  `httpx.MockTransport`. Raise `JobPostingNotFoundError` for a missing posting; let other HTTP
  and network errors propagate (`worker/retryable_errors.py` decides on retries).
- Return the site's values unchanged apart from trimming and unescaping.
