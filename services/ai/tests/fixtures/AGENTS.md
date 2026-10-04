# AGENTS.md — services/ai/tests/fixtures

## Purpose

Static test data for the pytest suite. Everything is synthetic.

## Contents

- `linkedin/job_with_headings.html` — a LinkedIn guest job page (trimmed to the parts the
  scraper reads) whose description has `<strong>Requirements<br><br></strong>` style headings
- `linkedin/job_without_headings.html` — a job with bullets but no headings and a company
  without a LinkedIn page link (sorting agent path)
