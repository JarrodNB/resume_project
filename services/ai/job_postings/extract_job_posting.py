"""
Description: Builds a ScrapedJobPosting from a scraped JobPage. Requirements come from the
posting's headings; only when no requirement heading matches does the sorting agent pick among the
posting's bullets, by number, so every requirement is still copied verbatim.
Index:
    - BulletSortingRun: the sorting agent's choice plus its token usage
    - BulletSorter: function that sorts numbered bullets (the agent in production, fakes in tests)
    - JobPostingExtraction: the posting plus the sorting run's usage (None when no LLM ran)
    - extract_job_posting: JobPage -> JobPostingExtraction
    - fit_posting_to_saved_limits: drops text Rails would refuse, and says so
    - pick_sorted_bullets: maps the agent's bullet numbers back to bullets, dropping invalid ones
"""

from collections.abc import Callable
from typing import NamedTuple

from pydantic_ai.usage import RunUsage

import text_limits
from job_postings.html_to_description_text import html_to_description_text
from job_postings.split_description_sections import split_description_sections
from schemas.scraped_job_posting import RequirementsSortedBy, ScrapedJobPosting
from schemas.sorted_requirement_bullets import SortedRequirementBullets
from scrapers.job_page import JobPage

LLM_SORTED_WARNING = (
    "This posting has no clear requirement headings, so AI sorted its bullet points into "
    "requirements, responsibilities, and nice-to-haves. Check them."
)
NO_BULLETS_WARNING = (
    "This posting has no bullet points, so no requirements were extracted. Add them by hand."
)
INVALID_NUMBERS_WARNING = "The AI sorting step referred to bullets that don't exist; ignored them."


class BulletSortingRun(NamedTuple):
    """Which bullets the agent chose, and the tokens it used."""

    sorted_bullets: SortedRequirementBullets
    usage: RunUsage


BulletSorter = Callable[[list[str]], BulletSortingRun]


class JobPostingExtraction(NamedTuple):
    """The extracted posting and, if the sorting agent ran, its usage."""

    posting: ScrapedJobPosting
    sorting_usage: RunUsage | None


def extract_job_posting(page: JobPage, sort_bullets: BulletSorter) -> JobPostingExtraction:
    """Splits the description by headings, falling back to sort_bullets when no requirement
    heading matched but the posting has bullets."""
    sections = split_description_sections(page.description_html)
    requirements = sections.requirements
    responsibilities = sections.responsibilities
    nice_to_haves = sections.nice_to_haves
    sorted_by: RequirementsSortedBy = "headings"
    warnings: list[str] = []
    sorting_usage: RunUsage | None = None

    if not requirements and sections.all_bullets and text_limits.sorting_input_too_long(sections.all_bullets):
        sorted_by = "none"
        warnings.append(text_limits.POSTING_TOO_LONG_TO_SORT_WARNING)
    elif not requirements and sections.all_bullets:
        sorting_run = sort_bullets(sections.all_bullets)
        requirements, responsibilities, nice_to_haves, had_invalid_numbers = pick_sorted_bullets(
            sections.all_bullets, sorting_run.sorted_bullets
        )
        sorted_by, sorting_usage = "llm", sorting_run.usage
        warnings.append(LLM_SORTED_WARNING)
        if had_invalid_numbers:
            warnings.append(INVALID_NUMBERS_WARNING)
    elif not sections.all_bullets:
        sorted_by = "none"
        warnings.append(NO_BULLETS_WARNING)

    posting = fit_posting_to_saved_limits(
        ScrapedJobPosting(
            source=page.source,
            source_url=page.source_url,
            title=page.title,
            company=page.company,
            location=page.location,
            description=html_to_description_text(page.description_html),
            requirements=requirements,
            responsibilities=responsibilities,
            nice_to_haves=nice_to_haves,
            requirements_sorted_by=sorted_by,
            warnings=warnings,
        )
    )
    return JobPostingExtraction(posting=posting, sorting_usage=sorting_usage)


def fit_posting_to_saved_limits(posting: ScrapedJobPosting) -> ScrapedJobPosting:
    """Shortens fields and drops bullets Rails would refuse, and warns that text was left out.
    A kept bullet is still copied verbatim."""
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
            if len(item) > text_limits.MAX_BULLET_TEXT or len(kept) >= text_limits.MAX_REQUIREMENT_ITEMS:
                left_out = True
                continue
            kept.append(item)
        return kept

    title = shorten(posting.title, text_limits.MAX_SHORT_TEXT) or ""
    company = shorten(posting.company, text_limits.MAX_SHORT_TEXT) or ""
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


def pick_sorted_bullets(
    bullets: list[str], sorted_bullets: SortedRequirementBullets
) -> tuple[list[str], list[str], list[str], bool]:
    """Returns (requirements, responsibilities, nice_to_haves, had_invalid_numbers). Numbers are
    1-based. Numbers out of range or repeated are dropped. A number in more than one list stays
    in the higher one: requirements, then nice-to-haves, then responsibilities. Each list keeps
    the posting's order."""
    valid_numbers = range(1, len(bullets) + 1)
    requirement_numbers = {n for n in sorted_bullets.requirement_numbers if n in valid_numbers}
    nice_to_have_numbers = {
        n for n in sorted_bullets.nice_to_have_numbers if n in valid_numbers
    } - requirement_numbers
    responsibility_numbers = {
        n for n in sorted_bullets.responsibility_numbers if n in valid_numbers
    } - requirement_numbers - nice_to_have_numbers
    all_numbers = (
        sorted_bullets.requirement_numbers
        + sorted_bullets.responsibility_numbers
        + sorted_bullets.nice_to_have_numbers
    )
    had_invalid_numbers = any(n not in valid_numbers for n in all_numbers)
    return (
        [bullets[n - 1] for n in sorted(requirement_numbers)],
        [bullets[n - 1] for n in sorted(responsibility_numbers)],
        [bullets[n - 1] for n in sorted(nice_to_have_numbers)],
        had_invalid_numbers,
    )
