"""
Description: Tests for the heading-based requirements split and the plain-text description.
Index:
    - test_*: one behavior per test
"""

import pytest

from job_postings.html_to_description_text import html_to_description_text
from job_postings.split_description_sections import classify_heading, split_description_sections


@pytest.mark.parametrize(
    ("heading", "kind"),
    [
        ("Requirements", "requirements"),
        ("Minimum Qualifications:", "requirements"),
        ("What you’ll bring", "requirements"),
        ("About you", "requirements"),
        ("What you should have", "requirements"),
        ("Your expertise:", "requirements"),
        ("What we look for:", "requirements"),
        ("What you'll need", "requirements"),
        ("Desirable Skills, Knowledge, and Experience", "nice_to_haves"),
        ("Preferred Qualifications", "nice_to_haves"),
        ("Nice-to-haves", "nice_to_haves"),
        ("Bonus points", "nice_to_haves"),
        ("Responsibilities", "other"),
        ("What you'll do", "other"),
        ("Benefits", "other"),
    ],
)
def test_classifies_common_headings(heading: str, kind: str) -> None:
    """Common wordings land in the right section; preferred beats qualifications."""
    assert classify_heading(heading) == kind


def test_files_bullets_under_their_heading() -> None:
    """Bullets under requirement and nice-to-have headings are split; others are only listed."""
    sections = split_description_sections(
        "<h3>Responsibilities</h3><ul><li>Build APIs</li></ul>"
        "<p><strong>Requirements</strong></p><ul><li><p>Python</p></li><li>SQL</li></ul>"
        "<p>Nice to have:</p><ul><li>Go</li></ul>"
    )

    assert sections.requirements == ["Python", "SQL"]
    assert sections.nice_to_haves == ["Go"]
    assert sections.all_bullets == ["Build APIs", "Python", "SQL", "Go"]


def test_nested_list_items_are_separate_bullets() -> None:
    """A parent item's text excludes its nested list, which becomes its own bullets."""
    sections = split_description_sections(
        "<h4>Requirements</h4><ul><li>Cloud experience:<ul><li>AWS</li></ul></li></ul>"
    )

    assert sections.requirements == ["Cloud experience:", "AWS"]


def test_keeps_inline_formatting_text_verbatim() -> None:
    """Bold words and punctuation inside a bullet don't gain extra spaces."""
    sections = split_description_sections(
        "<h3>Requirements</h3><ul><li>Use <b>PyTorch</b>, daily&nbsp;work</li></ul>"
    )

    assert sections.requirements == ["Use PyTorch, daily work"]


def test_long_bold_paragraph_is_not_a_heading() -> None:
    """Prose that happens to be bold doesn't start a section."""
    long_bold = (
        "<p><strong>" + "We are an equal opportunity employer and value " * 3 + "</strong></p>"
    )
    sections = split_description_sections(
        f"<h3>Requirements</h3>{long_bold}<ul><li>Python</li></ul>"
    )

    assert sections.requirements == ["Python"]


def test_no_requirement_headings_leaves_lists_empty() -> None:
    """Without a matching heading nothing is filed, but all bullets are kept for the fallback."""
    sections = split_description_sections("<p>Join us.</p><ul><li>Python</li><li>SQL</li></ul>")

    assert sections.requirements == []
    assert sections.all_bullets == ["Python", "SQL"]


def test_description_text_keeps_paragraphs_and_bullets() -> None:
    """Paragraphs are separated by a blank line and list items become '- ' lines."""
    text = html_to_description_text(
        "<h3>About</h3><p>We build <b>payments</b>.<br>Remote friendly.</p>"
        "<ul><li><p>Python</p></li><li>SQL</li></ul><p>Apply now.</p>"
    )

    assert text == "About\n\nWe build payments.\nRemote friendly.\n\n- Python\n- SQL\n\nApply now."
