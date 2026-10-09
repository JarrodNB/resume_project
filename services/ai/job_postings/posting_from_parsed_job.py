"""
Description: Turns a validated ParsedJobPosting into the ScrapedJobPosting Rails saves.
The description is the paste itself. Location and URL that are not in the paste are dropped.
Index:
    - NO_REQUIREMENTS_WARNING / DROPPED_LOCATION_WARNING / DROPPED_URL_WARNING: user-facing notes
    - posting_from_parsed_job: builds the posting and fits Rails' length limits
"""

from documents.text_matching import appears_in, normalize_text
from job_postings.extract_job_posting import fit_posting_to_saved_limits
from schemas.parsed_job_posting import ParsedJobPosting
from schemas.scraped_job_posting import ScrapedJobPosting

NO_REQUIREMENTS_WARNING = "No requirements were found in this posting. You can add them on the job page."
DROPPED_LOCATION_WARNING = "The location wasn't in the ad, so it was left off."
DROPPED_URL_WARNING = "The link wasn't in the ad, so it was left off."


def posting_from_parsed_job(source_text: str, parsed: ParsedJobPosting) -> ScrapedJobPosting:
    """Builds a pasted_text posting. Title, company, and bullets are kept as the model
    returned them; call this only after find_parsed_job_problems is empty."""
    warnings: list[str] = []
    location = _kept_optional(parsed.location, source_text, DROPPED_LOCATION_WARNING, warnings)
    url = _kept_url(parsed.url, source_text, warnings)
    requirements = _unique_items(parsed.requirements)
    responsibilities = _unique_items(parsed.responsibilities)
    nice_to_haves = _unique_items(parsed.nice_to_haves)
    if not requirements:
        warnings.append(NO_REQUIREMENTS_WARNING)
    sorted_by = "llm" if requirements or responsibilities or nice_to_haves else "none"
    posting = ScrapedJobPosting(
        source="pasted_text",
        source_url=url or "",
        title=parsed.title.strip(),
        company=parsed.company.strip(),
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
    """Keeps one http(s) link that appears in the ad."""
    kept = _kept_optional(value, source_text, DROPPED_URL_WARNING, warnings)
    if kept is None:
        return None
    if kept.startswith(("http://", "https://")):
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
