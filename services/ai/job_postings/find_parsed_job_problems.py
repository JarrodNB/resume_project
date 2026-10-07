"""
Description: Checks that a parsed job ad copied its title, company, and bullets from the paste.
Index:
    - find_parsed_job_problems: messages for the agent to fix, or an empty list
"""

from documents.text_matching import appears_in
from schemas.parsed_job_posting import ParsedJobPosting


def find_parsed_job_problems(parsed: ParsedJobPosting, source_text: str) -> list[str]:
    """Returns one message per field that is blank or not present in the pasted ad."""
    problems: list[str] = []
    if not appears_in(parsed.title, source_text):
        problems.append("title must be copied from the advertisement")
    if not appears_in(parsed.company, source_text):
        problems.append("company must be copied from the advertisement")
    problems.extend(_list_problems("requirements", parsed.requirements, source_text))
    problems.extend(_list_problems("nice_to_haves", parsed.nice_to_haves, source_text))
    return problems


def _list_problems(field_name: str, items: list[str], source_text: str) -> list[str]:
    """Messages for bullets that are not in the ad."""
    return [
        f"{field_name} item {index} is not in the advertisement: {item!r}"
        for index, item in enumerate(items, start=1)
        if not appears_in(item, source_text)
    ]
