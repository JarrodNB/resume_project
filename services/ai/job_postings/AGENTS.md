# AGENTS.md — services/ai/job_postings

## Purpose

Site-independent processing of a job posting: plain-text description and requirement /
nice-to-have bullets from scraped HTML, and the same ScrapedJobPosting built from a pasted ad.
Scraped and pasted ads reuse the same tool-free parser in `agents/`; domain helpers own
source checks and conversion. Deterministic HTML helpers remain available separately.

## Contents

- `html_to_description_text.py` — description HTML -> plain text (paragraphs, "- " bullets)
- `split_description_sections.py` — files each `<li>` under the nearest heading
  (`<h1>`-`<h6>`, an all-bold paragraph, or a short paragraph ending in ":"), classified as
  requirements, responsibilities, nice-to-haves, or other by keyword. Nice-to-have wordings win,
  then responsibilities ("responsibilities", "what you'll do", "the role"), then requirements
- `find_parsed_job_problems.py` — title, supplied company, and list spans must appear in the ad;
  an unstated company stays null through conversion and saved-length normalization
- `posting_from_parsed_job.py` — `ParsedJobPosting` -> `ScrapedJobPosting` (the paste is the
  description; a location or link that is not in the ad is dropped with a warning)
- `extract_job_posting.py` — `extract_job_posting(page, sort_bullets)` -> `ScrapedJobPosting`;
  calls `sort_bullets` (the job requirements sorting agent) only when no requirement heading
  matched but bullets exist, and skips it when there are more than 200 bullets or 40,000
  characters of bullet text (a warning says to add requirements by hand). Text Rails would
  refuse (more than 80 items in each of requirements, responsibilities, and nice-to-haves, a
  bullet over 1,000 characters, a description over 20,000, a short field over 200) is left out
  and the posting is still
  returned with a warning. URLs over the short-field cap are omitted rather than truncated;
  `pick_sorted_bullets` maps the agent's 1-based numbers back to bullets. When the sorter ran,
  `sorting_model` is the name to bill

## Local Rules

- Pasted ads keep injection screening and exact prompt coverage. Scraped ads use the
  source-only parser: cap the selected rendered text before generation, accept no history or
  tools, and never mark it as screened. Keep unrelated page text, private context and the job
  URL outside generation. The source guard and source-output checks remain mandatory.
- `scraped_job_ad.py` renders one selected scraped ad and builds the result through the shared
  parsed-posting converter. Requirements/duties/nice-to-haves must be source-supported spans
  from the description, including prose. Model-authored identity and URLs never overwrite
  acquired metadata. Empty descriptions and unsupported spans fail closed.
- Copied spans retain optional/required qualifiers; null/empty means absent. Deterministic
  heading extraction and the older bullet-number sorting helper are not the scrape-task path.
- When a real posting is split wrongly, add a synthetic case for it to
  `evals/datasets/job_posting_extraction_cases.yaml` and a unit test, then fix the responsible
  source rendering, parser instructions, or validator without weakening source checks.
