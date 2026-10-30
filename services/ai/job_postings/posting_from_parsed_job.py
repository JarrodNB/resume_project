"""
Description: Turns a validated ad parse into the posting Rails saves.
The description is selected source text. Scraped ads keep acquired metadata; pasted
ads drop locations and URLs unsupported by their text.
URLs retain exact source spelling because paths and query values can be case-sensitive.
Index:
    - NO_REQUIREMENTS_WARNING / DROPPED_LOCATION_WARNING / DROPPED_URL_WARNING: user-facing notes
    - posting_from_parsed_job: builds the posting and fits Rails' length limits
"""

from documents.text_matching import appears_in, normalize_text
from job_postings.extract_job_posting import fit_posting_to_saved_limits
from schemas.parsed_job_posting import ParsedJobPosting
from schemas.scraped_job_posting import ScrapedJobPosting
from scrapers.job_page import JobPage

NO_REQUIREMENTS_WARNING = "No requirements were found in this posting. You can add them on the job page."
DROPPED_LOCATION_WARNING = "The location wasn't in the ad, so it was left off."
DROPPED_URL_WARNING = "The link wasn't in the ad, so it was left off."


def posting_from_parsed_job(
    source_text: str, parsed: ParsedJobPosting, *, scraped_page: JobPage | None = None,
) -> ScrapedJobPosting:
    """Build a source-checked posting and apply saved limits once, after metadata selection.

    Call only after source validation. A scraped page supplies authoritative metadata;
    model-authored identity and links are ignored for that path.
    """
    warnings: list[str] = []
    if scraped_page is None:
        location = _kept_optional(parsed.location, source_text, DROPPED_LOCATION_WARNING, warnings)
        url = _kept_url(parsed.url, source_text, warnings)
    else:
        location = scraped_page.location.strip() if scraped_page.location else None
        url = scraped_page.source_url
    requirements = _unique_items(parsed.requirements)
    responsibilities = _unique_items(parsed.responsibilities)
    nice_to_haves = _unique_items(parsed.nice_to_haves)
    if not requirements:
        warnings.append(NO_REQUIREMENTS_WARNING)
    sorted_by = "llm" if requirements or responsibilities or nice_to_haves else "none"
    posting = ScrapedJobPosting(
        source=scraped_page.source if scraped_page else "pasted_text",
        source_url=url or "",
        title=(scraped_page.title if scraped_page else parsed.title).strip(),
        company=(scraped_page.company.strip() or None) if scraped_page else (
            parsed.company.strip() if parsed.company is not None else None
        ),
        location=location,
        description=source_text.strip(),
        requirements=requirements,
        responsibilities=responsibilities,
        nice_to_haves=nice_to_haves,
        requirements_sorted_by=sorted_by,
        warnings=warnings,
    )
    return fit_posting_to_saved_limits(posting)


def _kept_optional(value: str | None, source_text: str, warning: str, warnings: list[str]) -> str | None:
    """Keeps a field that appears in the ad. Drops anything else and records a warning."""
    if value is None or not value.strip():
        return None
    if appears_in(value, source_text):
        return value.strip()
    warnings.append(warning)
    return None


def _kept_url(value: str | None, source_text: str, warnings: list[str]) -> str | None:
    """Keep an exactly copied http(s) link without applying prose normalization."""
    if value is None or not value.strip():
        return None
    kept = value.strip()
    if kept.startswith(("http://", "https://")) and kept in source_text:
        return kept
    warnings.append(DROPPED_URL_WARNING)
    return None


def _unique_items(items: list[str]) -> list[str]:
    """Drops blank and repeated bullets, keeping the first copy."""
    seen: set[str] = set()
    unique: list[str] = []
    for item in items:
        stripped = item.strip()
        key = normalize_text(stripped)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(stripped)
    return unique
