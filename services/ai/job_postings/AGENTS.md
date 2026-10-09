# AGENTS.md — services/ai/job_postings

## Purpose

Site-independent processing of a job posting: plain-text description and requirement /
nice-to-have bullets from scraped HTML, and the same ScrapedJobPosting built from a pasted ad.
Deterministic, except for the optional bullet-sorting fallback and the pasted-ad parse, which
are passed in or live in `agents/`.

## Contents

- `html_to_description_text.py` — description HTML -> plain text (paragraphs, "- " bullets)
- `split_description_sections.py` — files each `<li>` under the nearest heading
  (`<h1>`-`<h6>`, an all-bold paragraph, or a short paragraph ending in ":"), classified as
  requirements, responsibilities, nice-to-haves, or other by keyword. Nice-to-have wordings win,
  then responsibilities ("responsibilities", "what you'll do", "the role"), then requirements
- `find_parsed_job_problems.py` — title, company, and bullets must appear in a pasted ad
- `posting_from_parsed_job.py` — `ParsedJobPosting` -> `ScrapedJobPosting` (the paste is the
  description; a location or link that is not in the ad is dropped with a warning)
- `extract_job_posting.py` — `extract_job_posting(page, sort_bullets)` -> `ScrapedJobPosting`;
  calls `sort_bullets` (the job requirements sorting agent) only when no requirement heading
  matched but bullets exist, and skips it when there are more than 200 bullets or 40,000
  characters of bullet text (a warning says to add requirements by hand). Text Rails would
  refuse (more than 80 items in each of requirements, responsibilities, and nice-to-haves, a
  bullet over 1,000 characters, a description over 20,000, a short field over 200) is left out
  and the posting is still
  returned with a warning;
  `pick_sorted_bullets` maps the agent's 1-based numbers back to bullets. When the sorter ran,
  `sorting_model` is the name to bill

## Local Rules

- Requirements, responsibilities, and nice-to-haves are always bullets copied verbatim from the posting. For a
  scraped page the LLM may only choose among them by number. For a pasted ad the parse agent
  copies spans, and `find_parsed_job_problems` rejects any that are not in the text.
- When a real posting is split wrongly, add a synthetic case for it to
  `evals/datasets/job_posting_extraction_cases.yaml` and a unit test, then adjust the heading
  keywords.
