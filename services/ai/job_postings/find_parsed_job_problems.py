"""Check that parsed job fields occur in their selected advertisement source.

An unstated employer may be null. Scraped qualifications can use the description
alone as evidence, excluding metadata and application-owned field labels.
"""

from documents.text_matching import appears_in
from schemas.parsed_job_posting import ParsedJobPosting


def find_parsed_job_problems(
    parsed: ParsedJobPosting, source_text: str, *, list_source_text: str | None = None,
) -> list[str]:
    """Reject unsupported text; scraped lists may require description-only evidence."""
    problems: list[str] = []
    if not appears_in(parsed.title, source_text):
        problems.append("title must be copied from the advertisement")
    if parsed.company is not None and not appears_in(parsed.company, source_text):
        problems.append("company must be copied from the advertisement")
    list_source = source_text if list_source_text is None else list_source_text
    problems.extend(_list_problems("requirements", parsed.requirements, list_source))
    problems.extend(_list_problems("responsibilities", parsed.responsibilities, list_source))
    problems.extend(_list_problems("nice_to_haves", parsed.nice_to_haves, list_source))
    return problems


def _list_problems(field_name: str, items: list[str], source_text: str) -> list[str]:
    """Messages for bullets that are not in the ad."""
    return [
        f"{field_name} item {index} is not in the advertisement: {item!r}"
        for index, item in enumerate(items, start=1)
        if not appears_in(item, source_text)
    ]
