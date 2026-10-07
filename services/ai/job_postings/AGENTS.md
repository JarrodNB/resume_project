# AGENTS.md — services/ai/job_postings

## Purpose

Site-independent processing of a scraped job posting (`scrapers.job_page.JobPage`): plain-text
description and requirement / nice-to-have bullets. Deterministic, except for the optional
bullet-sorting fallback, which is passed in as a function.

## Contents

- `html_to_description_text.py` — description HTML -> plain text (paragraphs, "- " bullets)
- `split_description_sections.py` — files each `<li>` under the nearest heading
  (`<h1>`-`<h6>`, an all-bold paragraph, or a short paragraph ending in ":"), classified as
  requirements, nice-to-haves, or other by keyword
- `extract_job_posting.py` — `extract_job_posting(page, sort_bullets)` -> `ScrapedJobPosting`;
  calls `sort_bullets` (the job requirements sorting agent) only when no requirement heading
  matched but bullets exist, and skips it when there are more than 200 bullets or 40,000
  characters of bullet text (a warning says to add requirements by hand). Text Rails would
  refuse (more than 80 requirements or nice-to-haves, a bullet over 1,000 characters, a
  description over 20,000, a short field over 200) is left out and the posting is still
  returned with a warning;
  `pick_sorted_bullets` maps the agent's 1-based numbers back to bullets

## Local Rules

- Requirements and nice-to-haves are always bullets copied verbatim from the posting. The LLM
  may only choose among them by number.
- When a real posting is split wrongly, add a synthetic case for it to
  `evals/datasets/job_posting_extraction_cases.yaml` and a unit test, then adjust the heading
  keywords.
