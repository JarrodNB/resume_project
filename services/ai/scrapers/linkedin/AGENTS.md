# AGENTS.md — services/ai/scrapers/linkedin

## Purpose

Scrapes LinkedIn job postings from the public guest job page LinkedIn shows signed-out visitors
(`GET https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}`, no login). The page has
no structured data (no JSON-LD), so fields are read from its stable top card and description
class names.

## Contents

- `parse_linkedin_job_url.py` — `is_linkedin_url`, `parse_linkedin_job_id` (`/jobs/view/{id}`,
  `/jobs/view/{slug}-{id}`, `/comm/jobs/view/{id}`, `/jobs/...?currentJobId={id}`),
  `linkedin_job_url` (canonical link)
- `fetch_linkedin_job.py` — `fetch_linkedin_job_html` (404 -> `JobPostingNotFoundError`)
- `linkedin_description_to_html.py` — `linkedin_description_to_html`: `<br>`-separated lines
  become `<p>`s so `<strong>Heading<br><br></strong>` reads as a bold heading
- `linkedin_job_html_to_page.py` — `linkedin_job_html_to_page` (no title ->
  `JobPageUnreadableError`), `scrape_linkedin_job` (the registered scrape function)

## Local Rules

- Fetch only the one job a user pasted. Never crawl search results or many jobs in a row
  (LinkedIn's terms forbid scraping; it also throttles with 429 and its own 999 status).
- Selectors live as constants at the top of `linkedin_job_html_to_page.py`. If LinkedIn changes
  its layout, update them and the synthetic fixtures in `tests/fixtures/linkedin/`.
