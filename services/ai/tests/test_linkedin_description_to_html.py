"""Check LinkedIn description paragraphs and the headings they expose.

Nested inline formatting must preserve line breaks, attributes, and punctuation
so the shared heading splitter can file bullets without a model call.
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


def test_nested_inline_line_breaks_preserve_section_headings() -> None:
    """Formatting wrappers do not hide a heading below introductory prose."""
    markup = (
        '<span class="outer"><span class="inner">Join our team.<br>'
        '<strong>Requirements</strong><br></span></span><ul><li>Python</li></ul>'
        '<span><em>More about you<br><b>Preferred Qualifications</b><br></em></span>'
        '<ul><li>Go</li></ul>'
    )

    html = linkedin_description_to_html(markup)
    sections = split_description_sections(html)

    assert sections.requirements == ["Python"]
    assert sections.nice_to_haves == ["Go"]
    assert '<span class="outer"><span class="inner"><strong>Requirements</strong>' in html


def test_nested_breaks_keep_inline_punctuation_and_links() -> None:
    """Splitting nested formatting retains attributes and surrounding inline text."""
    html = linkedin_description_to_html(
        'Use <span><em>Python<br><a href="https://example.com">SQL</a></em></span>, daily.'
    )

    assert html == (
        '<p>Use <span><em>Python</em></span></p>'
        '<p><span><em><a href="https://example.com">SQL</a></em></span>, daily.</p>'
    )
