"""
Description: Tests for building a ScrapedJobPosting: heading split first, the sorting function
only as a fallback, and mapping the agent's bullet numbers back to verbatim bullets.
Index:
    - build_page: a JobPage with the given description HTML
    - test_*: one behavior per test
"""

import pytest
from pydantic_ai.usage import RunUsage

from job_postings.extract_job_posting import (
    INVALID_NUMBERS_WARNING,
    LLM_SORTED_WARNING,
    NO_BULLETS_WARNING,
    BulletSortingRun,
    extract_job_posting,
    pick_sorted_bullets,
)
from schemas.sorted_requirement_bullets import SortedRequirementBullets
from scrapers.job_page import JobPage


def build_page(description_html: str) -> JobPage:
    """A LinkedIn JobPage for Acme with the given description."""
    return JobPage(
        source="linkedin",
        source_url="https://www.linkedin.com/jobs/view/1/",
        title="Engineer",
        company="Acme",
        location="Remote",
        description_html=description_html,
    )


def never_called(_bullets: list[str]) -> BulletSortingRun:
    """A sorter that fails the test if the fallback runs."""
    raise AssertionError("the sorting agent should not run")


def test_headings_fill_requirements_without_the_agent() -> None:
    """A posting with requirement headings never calls the sorter."""
    page = build_page("<h3>Requirements</h3><ul><li>Python</li></ul>")

    extraction = extract_job_posting(page, never_called)

    assert extraction.posting.requirements == ["Python"]
    assert extraction.posting.requirements_sorted_by == "headings"
    assert extraction.posting.warnings == []
    assert extraction.sorting_usage is None


def test_falls_back_to_the_sorter_without_requirement_headings() -> None:
    """Bullets without headings go to the sorter, and its numbers pick the bullets."""
    page = build_page("<ul><li>Run clusters</li><li>Kubernetes</li><li>Go is a plus</li></ul>")
    usage = RunUsage(input_tokens=50, output_tokens=10)
    received: list[list[str]] = []

    def sort_bullets(bullets: list[str]) -> BulletSortingRun:
        """Records its input and labels bullet 2 required, 3 a nice-to-have."""
        received.append(bullets)
        sorted_bullets = SortedRequirementBullets(requirement_numbers=[2], nice_to_have_numbers=[3])
        return BulletSortingRun(sorted_bullets=sorted_bullets, usage=usage)

    extraction = extract_job_posting(page, sort_bullets)

    assert received == [["Run clusters", "Kubernetes", "Go is a plus"]]
    assert extraction.posting.requirements == ["Kubernetes"]
    assert extraction.posting.nice_to_haves == ["Go is a plus"]
    assert extraction.posting.requirements_sorted_by == "llm"
    assert extraction.posting.warnings == [LLM_SORTED_WARNING]
    assert extraction.sorting_usage is usage


def test_posting_without_bullets_warns_and_skips_the_agent() -> None:
    """Prose-only postings get empty lists and a warning."""
    extraction = extract_job_posting(build_page("<p>We need a great engineer.</p>"), never_called)

    assert extraction.posting.requirements_sorted_by == "none"
    assert extraction.posting.warnings == [NO_BULLETS_WARNING]
    assert extraction.posting.description == "We need a great engineer."


@pytest.mark.parametrize(
    ("requirement_numbers", "nice_to_have_numbers", "expected"),
    [
        ([3, 1], [2], (["a", "c"], ["b"], False)),
        ([1, 1], [1, 2], (["a"], ["b"], False)),
        ([0, 4, 2], [-1], (["b"], [], True)),
    ],
)
def test_pick_sorted_bullets_keeps_order_and_drops_invalid_numbers(
    requirement_numbers: list[int],
    nice_to_have_numbers: list[int],
    expected: tuple[list[str], list[str], bool],
) -> None:
    """Posting order is kept, repeats collapse, requirements win ties, bad numbers are flagged."""
    sorted_bullets = SortedRequirementBullets(
        requirement_numbers=requirement_numbers, nice_to_have_numbers=nice_to_have_numbers
    )

    assert pick_sorted_bullets(["a", "b", "c"], sorted_bullets) == expected


def test_invalid_numbers_add_a_warning() -> None:
    """The user is told when the agent referred to bullets that don't exist."""
    page = build_page("<ul><li>Python</li></ul>")

    def sort_bullets(_bullets: list[str]) -> BulletSortingRun:
        """Answers with a bullet number that doesn't exist."""
        sorted_bullets = SortedRequirementBullets(requirement_numbers=[1, 9])
        return BulletSortingRun(sorted_bullets=sorted_bullets, usage=RunUsage())

    extraction = extract_job_posting(page, sort_bullets)

    assert extraction.posting.requirements == ["Python"]
    assert INVALID_NUMBERS_WARNING in extraction.posting.warnings
