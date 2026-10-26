"""Check heading-based job sections and readable description text.

Bullets retain rendered word boundaries, inline punctuation, and their own
text when nested lists appear.
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
        ("Responsibilities", "responsibilities"),
        ("What you'll do", "responsibilities"),
        ("What you'll be doing", "responsibilities"),
        ("Key duties", "responsibilities"),
        ("In this role", "responsibilities"),
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
    assert sections.responsibilities == ["Build APIs"]
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


@pytest.mark.parametrize("hidden", [
    "<!-- internal tracking marker -->",
    "<script>internalTracking()</script>",
    "<style>.tracking { color: red; }</style>",
])
def test_bullets_exclude_nonrendered_html(hidden: str) -> None:
    """Hidden HTML is not part of the requirement visible to the user."""
    sections = split_description_sections(
        f"<h3>Requirements</h3><ul><li>Use {hidden}<b>Python</b>, daily.</li></ul>"
    )

    assert sections.requirements == ["Use Python, daily."]
    assert sections.all_bullets == ["Use Python, daily."]


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


@pytest.mark.parametrize("tag", ["p", "div"])
def test_description_bullet_blocks_keep_word_boundaries(tag: str) -> None:
    """Paragraphs in one bullet stay readable without merging adjacent words."""
    text = html_to_description_text(
        f"<ul><li><{tag}>Build <b>APIs</b>, daily.</{tag}>"
        f"<{tag}>Maintain services.</{tag}></li><li>Python</li></ul>"
    )

    assert text == "- Build APIs, daily. Maintain services.\n- Python"


@pytest.mark.parametrize(
    ("bullet_html", "expected"),
    [
        ("Python<br>SQL", "Python SQL"),
        ("<p>Build APIs</p><p>Maintain services</p>", "Build APIs Maintain services"),
        ("<div>Python</div><div>SQL</div>", "Python SQL"),
        ("Use <b>Python</b>, daily", "Use Python, daily"),
        ("Cloud<br>experience:<ul><li>AWS</li></ul>", "Cloud experience:"),
    ],
)
def test_bullet_rendered_breaks_separate_words(bullet_html: str, expected: str) -> None:
    """Rendered breaks separate words without altering inline text or copying nested lists."""
    sections = split_description_sections(f"<h3>Requirements</h3><ul><li>{bullet_html}</li></ul>")

    assert sections.requirements[0] == expected
    if "<ul>" in bullet_html:
        assert sections.requirements == [expected, "AWS"]


@pytest.mark.parametrize("heading", [
    "<b><strong>Requirements</strong></b>",
    "<strong>Required <b>Skills</b></strong>",
    "<b>Required</b> <strong><b>Skills</b></strong>",
])
def test_nested_bold_headings_keep_requirement_bullets(heading: str) -> None:
    """Nested emphasis does not count the same heading words twice."""
    sections = split_description_sections(f"<p>{heading}</p><ul><li>Python</li></ul>")

    assert sections.requirements == ["Python"]


def test_partially_bold_prose_is_not_a_heading() -> None:
    """Recognizing nested emphasis must still require the whole paragraph to be bold."""
    sections = split_description_sections(
        "<p>We value <b><strong>Skills</strong></b></p><ul><li>Python</li></ul>"
    )

    assert sections.requirements == []
    assert sections.all_bullets == ["Python"]
