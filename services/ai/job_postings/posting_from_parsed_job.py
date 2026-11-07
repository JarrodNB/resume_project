"""Turn a source-checked ad parse into the posting Rails saves.

Pasted and generic HTML ads use parsed identity; structured scrapes keep acquired
metadata. When parsed identity is used, an optional location must appear in the
source, and so must a pasted link. Saved length limits apply after selection.
Links keep their exact spelling because paths and query values can be case-sensitive.
"""

import text_limits
from documents.text_matching import appears_in, normalize_text
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

    Call only after source validation. Structured metadata stays authoritative;
    raw HTML uses source-supported parsed identity. Scraped URLs always come from the task.
    """
    warnings: list[str] = []
    use_parsed_identity = scraped_page is None or not scraped_page.metadata_is_authoritative
    if use_parsed_identity:
        title = parsed.title.strip()
        company = parsed.company.strip() if parsed.company is not None else None
        location = _kept_optional(parsed.location, source_text, DROPPED_LOCATION_WARNING, warnings)
        url = scraped_page.source_url if scraped_page else _kept_url(parsed.url, source_text, warnings)
    else:
        title = scraped_page.title.strip()
        company = scraped_page.company.strip() or None
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
        title=title,
        company=company,
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


def fit_posting_to_saved_limits(posting: ScrapedJobPosting) -> ScrapedJobPosting:
    """Fit fields to Rails limits, dropping oversized links instead of changing their targets.
    A kept bullet is still copied verbatim; omitted content adds a warning."""
    left_out = False

    def shorten(value: str | None, limit: int) -> str | None:
        """Keeps a field Rails can store. None stays None."""
        nonlocal left_out
        if value is None or len(value) <= limit:
            return value
        left_out = True
        return value[:limit]

    def keep_items(items: list[str]) -> list[str]:
        """Drops a bullet over the character cap, then anything past the count cap."""
        nonlocal left_out
        kept: list[str] = []
        for item in items:
            if (
                len(item) > text_limits.MAX_BULLET_TEXT
                or len(kept) >= text_limits.MAX_REQUIREMENT_ITEMS
            ):
                left_out = True
                continue
            kept.append(item)
        return kept

    source_url = posting.source_url
    if len(source_url) > text_limits.MAX_JOB_URL:
        source_url = ""
        left_out = True
    title = shorten(posting.title, text_limits.MAX_SHORT_TEXT) or ""
    company = shorten(posting.company, text_limits.MAX_SHORT_TEXT)
    location = shorten(posting.location, text_limits.MAX_SHORT_TEXT)
    description = shorten(posting.description, text_limits.MAX_JOB_DESCRIPTION) or ""
    requirements = keep_items(posting.requirements)
    responsibilities = keep_items(posting.responsibilities)
    nice_to_haves = keep_items(posting.nice_to_haves)
    warnings = list(posting.warnings)
    if left_out:
        warnings.append(text_limits.POSTING_LEFT_OUT_WARNING)
    return posting.model_copy(
        update={
            "source_url": source_url,
            "title": title,
            "company": company,
            "location": location,
            "description": description,
            "requirements": requirements,
            "responsibilities": responsibilities,
            "nice_to_haves": nice_to_haves,
            "warnings": warnings,
        }
    )
