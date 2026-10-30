"""Prepare one scraped ad for the shared parser and retain its original identity.

Only the selected job description and top-card fields reach the parser. Parsed
qualifications must occur in the description; model-authored identity and links
never replace the scraper's values.
"""

from job_postings.find_parsed_job_problems import find_parsed_job_problems
from job_postings.html_to_description_text import html_to_description_text
from job_postings.posting_from_parsed_job import posting_from_parsed_job
from schemas.parsed_job_posting import ParsedJobPosting
from schemas.scraped_job_posting import ScrapedJobPosting
from scrapers.job_page import JobPage, JobPageUnreadableError

PARSED_SCRAPE_WARNING = "AI identified the requirements and duties from this posting. Check them."


def scraped_job_ad_text(page: JobPage) -> str:
    """Render readable source fields; keep URL authority outside the model input."""
    description = html_to_description_text(page.description_html)
    if not page.title.strip() or not description.strip():
        raise JobPageUnreadableError("The posting has no readable title or description")
    fields = [f"Title: {page.title.strip()}"]
    if page.company.strip():
        fields.append(f"Company: {page.company.strip()}")
    if page.location and page.location.strip():
        fields.append(f"Location: {page.location.strip()}")
    return "\n".join(fields) + "\n\n" + description


def posting_from_scraped_ad(page: JobPage, parsed: ParsedJobPosting) -> ScrapedJobPosting:
    """Reject unsupported spans and preserve acquired metadata, description and URL."""
    description = html_to_description_text(page.description_html)
    # Validate identity against all selected source fields, but qualifications and
    # duties against the description alone, excluding our field labels/metadata.
    problems = find_parsed_job_problems(
        parsed, scraped_job_ad_text(page), list_source_text=description,
    )
    if problems:
        raise ValueError("Parsed job fields are not supported by the scraped advertisement")
    posting = posting_from_parsed_job(description, parsed, scraped_page=page)
    posting.warnings.append(PARSED_SCRAPE_WARNING)
    return posting
