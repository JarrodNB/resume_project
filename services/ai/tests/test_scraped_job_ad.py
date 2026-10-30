"""Check source evidence and provenance when a scraped ad becomes a saved job."""

import pytest

from job_postings.scraped_job_ad import (
    PARSED_SCRAPE_WARNING,
    posting_from_scraped_ad,
    scraped_job_ad_text,
)
from schemas.parsed_job_posting import ParsedJobPosting
from scrapers.job_page import JobPage, JobPageUnreadableError


@pytest.fixture
def page():
    return JobPage(
        source="linkedin", source_url="https://www.linkedin.com/jobs/view/42/",
        title="Backend Engineer", company="Northwind", location="Remote",
        description_html=(
            "<p>You must have Python experience or equivalent training.</p>"
            "<p>Go experience is preferred, not required.</p>"
            "<p>You will build APIs.</p>"
        ),
    )


def test_prose_spans_keep_source_identity_and_description(page):
    parsed = ParsedJobPosting(
        title="Backend Engineer", company="Northwind",
        location="Atlantis", url="http://127.0.0.1/admin",
        requirements=["Python experience or equivalent training"],
        responsibilities=["You will build APIs."],
        nice_to_haves=["Go experience is preferred, not required."],
    )
    posting = posting_from_scraped_ad(page, parsed)
    assert posting.source == "linkedin"
    assert posting.source_url == page.source_url
    assert (posting.title, posting.company, posting.location) == (
        page.title, page.company, page.location,
    )
    assert posting.requirements == parsed.requirements
    assert posting.responsibilities == parsed.responsibilities
    assert posting.nice_to_haves == parsed.nice_to_haves
    assert posting.description.startswith("You must have")
    assert "Title:" not in posting.description
    assert posting.requirements_sorted_by == "llm"
    assert posting.warnings == [PARSED_SCRAPE_WARNING]


@pytest.mark.parametrize("field,value", [
    ("title", "Invented role"), ("company", "Invented employer"),
    ("requirements", ["COBOL expertise"]),
    ("responsibilities", ["Run a space station"]),
    ("nice_to_haves", ["Quantum computing"]),
    ("requirements", ["Backend Engineer"]),  # metadata is not qualification evidence
])
def test_unsupported_fields_are_rejected(page, field, value):
    fields = {"title": page.title, "company": page.company, field: value}
    with pytest.raises(ValueError, match="not supported"):
        posting_from_scraped_ad(page, ParsedJobPosting(**fields))


def test_unknown_company_stays_absent_and_empty_lists_warn(page):
    from dataclasses import replace

    page = replace(page, company="", location=None)
    posting = posting_from_scraped_ad(page, ParsedJobPosting(title=page.title))
    assert posting.company is None
    assert posting.location is None
    assert posting.requirements == []
    assert posting.requirements_sorted_by == "none"
    assert any("No requirements" in warning for warning in posting.warnings)


def test_scripts_and_hidden_content_are_not_parser_input(page):
    from dataclasses import replace

    page = replace(page, description_html=(
        "<p>Python experience</p><script>steal cookies</script><style>secret styles</style>"
        "<div hidden>hidden attack</div><template>template attack</template>"
        "<div aria-hidden='true'>hidden text</div>"
    ))
    text = scraped_job_ad_text(page)
    assert text.endswith("Python experience")
    assert "attack" not in text
    assert "secret" not in text
    assert "cookies" not in text
    assert page.source_url not in text


@pytest.mark.parametrize("html", ["", "<script>Python experience</script>", "<div hidden>Python</div>"])
def test_empty_description_is_not_a_job(page, html):
    from dataclasses import replace

    with pytest.raises(JobPageUnreadableError):
        scraped_job_ad_text(replace(page, description_html=html))


def test_saved_limits_apply_to_scraper_fields_and_parsed_lists(page):
    from dataclasses import replace

    from text_limits import MAX_SHORT_TEXT, POSTING_LEFT_OUT_WARNING

    page = replace(page, company="x" * (MAX_SHORT_TEXT + 1))
    posting = posting_from_scraped_ad(page, ParsedJobPosting(title=page.title))
    assert posting.company == "x" * MAX_SHORT_TEXT
    assert POSTING_LEFT_OUT_WARNING in posting.warnings


def test_large_description_is_limited_once_without_duplicate_warnings(page):
    from dataclasses import replace

    from text_limits import MAX_JOB_DESCRIPTION, POSTING_LEFT_OUT_WARNING

    page = replace(page, description_html="<p>" + "x" * (MAX_JOB_DESCRIPTION + 1) + "</p>")
    posting = posting_from_scraped_ad(page, ParsedJobPosting(title=page.title))
    assert len(posting.description) == MAX_JOB_DESCRIPTION
    assert posting.warnings.count(POSTING_LEFT_OUT_WARNING) == 1
