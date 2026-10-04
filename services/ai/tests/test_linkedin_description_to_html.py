"""
Description: Tests for turning LinkedIn's <br>-separated description into paragraphs that the
heading splitter understands.
Index:
    - test_*: one behavior per test
"""

from job_postings.split_description_sections import split_description_sections
from scrapers.linkedin.linkedin_description_to_html import linkedin_description_to_html


def test_bold_lines_become_bold_paragraphs() -> None:
    """`<strong>Heading<br><br></strong>` becomes `<p><strong>Heading</strong></p>`."""
    html = linkedin_description_to_html(
        "Intro text.<br><br><strong>Requirements<br><br></strong><ul><li>Python</li></ul>"
    )

    assert html == (
        "<p>Intro text.</p><p><strong>Requirements</strong></p><ul><li>Python</li></ul>"
    )


def test_inline_formatting_stays_inside_its_line() -> None:
    """Bold words mid-sentence and escaped characters are kept as they were."""
    html = linkedin_description_to_html("Use <strong>Go</strong> &amp; Rust daily.<br>Next line")

    assert html == "<p>Use <strong>Go</strong> &amp; Rust daily.</p><p>Next line</p>"


def test_headings_split_real_linkedin_layout() -> None:
    """Plain-text lines aren't headings; bold lines are; prose after a list isn't a bullet."""
    markup = (
        "Who you are<br><br>We want someone who meets the minimum requirements.<br><br>"
        "<strong>Minimum Requirements<br><br></strong><ul><li>5+ years of Python</li></ul>"
        "<strong>Preferred Qualifications<br><br></strong><ul><li>Kafka</li></ul>"
        "Hybrid work<br><br>Office three days a week.<br><br>"
    )

    sections = split_description_sections(linkedin_description_to_html(markup))

    assert sections.requirements == ["5+ years of Python"]
    assert sections.nice_to_haves == ["Kafka"]
