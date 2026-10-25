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
from text_limits import (
    MAX_BULLET_TEXT,
    MAX_JOB_DESCRIPTION,
    MAX_REQUIREMENT_ITEMS,
    MAX_SHORT_TEXT,
    POSTING_LEFT_OUT_WARNING,
    POSTING_TOO_LONG_TO_SORT_WARNING,
)


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


def test_hidden_markup_is_not_saved_as_job_requirements() -> None:
    """Structured requirements match the visible saved description, not hidden HTML."""
    page = build_page(
        "<h3>Requirements</h3><ul><li>Use <!-- tracking -->"
        "<script>tracking()</script><style>.tracking { color: red; }</style>"
        "<b>Python</b>, daily.</li></ul>"
    )

    posting = extract_job_posting(page, never_called).posting

    assert posting.requirements == ["Use Python, daily."]
    assert posting.description == "Requirements\n\n- Use Python, daily."


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
    assert extraction.posting.responsibilities == []
    assert extraction.posting.nice_to_haves == ["Go is a plus"]
    assert extraction.posting.requirements_sorted_by == "llm"
    assert extraction.posting.warnings == [LLM_SORTED_WARNING]
    assert extraction.sorting_usage is usage


def test_too_many_bullets_skip_the_sorter_and_warn() -> None:
    """A posting the sorter cannot take is saved without requirements and says why."""
    bullets = "".join(f"<li>Bullet {index}</li>" for index in range(201))
    page = build_page(f"<ul>{bullets}</ul>")

    extraction = extract_job_posting(page, never_called)

    assert extraction.posting.requirements == []
    assert extraction.posting.requirements_sorted_by == "none"
    assert extraction.sorting_usage is None
    assert POSTING_TOO_LONG_TO_SORT_WARNING in extraction.posting.warnings


def test_heading_extraction_accepts_exactly_the_saved_item_limit() -> None:
    """Exactly 80 required items fit Rails' saved posting contract without warnings."""
    items = "".join(f"<li>Requirement {index}</li>" for index in range(MAX_REQUIREMENT_ITEMS))

    posting = extract_job_posting(build_page(f"<h3>Requirements</h3><ul>{items}</ul>"), never_called).posting

    assert len(posting.requirements) == MAX_REQUIREMENT_ITEMS
    assert POSTING_LEFT_OUT_WARNING not in posting.warnings


def test_heading_extraction_over_the_save_caps_still_returns_a_posting() -> None:
    """Rails would refuse more than 80 requirements, a long bullet, or a long description.
    Those are left out and the posting is still returned, with a warning."""
    short = "".join("<li>Python</li>" for _ in range(MAX_REQUIREMENT_ITEMS + 1))
    long_bullet = "x" * (MAX_BULLET_TEXT + 1)
    long_description = "d" * (MAX_JOB_DESCRIPTION + 1)
    page = JobPage(
        source="linkedin",
        source_url="https://www.linkedin.com/jobs/view/1/",
        title="T" * (MAX_SHORT_TEXT + 1),
        company="Acme",
        location=None,
        description_html=(
            f"<p>{long_description}</p><h3>Requirements</h3><ul>{short}"
            f"<li>{long_bullet}</li></ul>"
        ),
    )

    extraction = extract_job_posting(page, never_called)

    posting = extraction.posting
    assert len(posting.title) == MAX_SHORT_TEXT
    assert len(posting.description) == MAX_JOB_DESCRIPTION
    assert posting.requirements == ["Python"] * MAX_REQUIREMENT_ITEMS
    assert long_bullet not in posting.requirements
    assert all(len(item) <= MAX_BULLET_TEXT for item in posting.requirements)
    assert POSTING_LEFT_OUT_WARNING in posting.warnings
    assert extraction.sorting_usage is None


@pytest.mark.parametrize("extra_characters", [0, 1])
def test_heading_extraction_checks_each_bullet_at_its_save_limit(extra_characters: int) -> None:
    """The exact saved bullet limit is retained; one extra character is omitted."""
    bullet = "x" * (MAX_BULLET_TEXT + extra_characters)
    extraction = extract_job_posting(
        build_page(f"<h3>Requirements</h3><ul><li>{bullet}</li></ul>"), never_called
    )

    assert extraction.posting.requirements == ([bullet] if not extra_characters else [])
    assert (POSTING_LEFT_OUT_WARNING in extraction.posting.warnings) is bool(extra_characters)


def test_posting_without_bullets_warns_and_skips_the_agent() -> None:
    """Prose-only postings get empty lists and a warning."""
    extraction = extract_job_posting(build_page("<p>We need a great engineer.</p>"), never_called)

    assert extraction.posting.requirements_sorted_by == "none"
    assert extraction.posting.warnings == [NO_BULLETS_WARNING]
    assert extraction.posting.description == "We need a great engineer."


@pytest.mark.parametrize(
    ("requirement_numbers", "responsibility_numbers", "nice_to_have_numbers", "expected"),
    [
        ([3, 1], [], [2], (["a", "c"], [], ["b"], False)),
        ([1, 1], [1], [1, 2], (["a"], [], ["b"], False)),
        ([0, 4, 2], [2], [-1], (["b"], [], [], True)),
        ([], [1, 2], [2], ([], ["a"], ["b"], False)),
    ],
)
def test_pick_sorted_bullets_keeps_order_and_drops_invalid_numbers(
    requirement_numbers: list[int],
    responsibility_numbers: list[int],
    nice_to_have_numbers: list[int],
    expected: tuple[list[str], list[str], list[str], bool],
) -> None:
    """Posting order is kept, repeats collapse, higher lists win ties, bad numbers are flagged."""
    sorted_bullets = SortedRequirementBullets(
        requirement_numbers=requirement_numbers,
        responsibility_numbers=responsibility_numbers,
        nice_to_have_numbers=nice_to_have_numbers,
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
