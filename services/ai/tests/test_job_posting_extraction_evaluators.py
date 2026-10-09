"""
Description: Sanity checks for the job posting extraction eval dataset and evaluators (no LLM
calls): hand labels score 1.0, and the heading split alone gets every heading-labelled case right.
Index:
    - test_hand_labels_get_perfect_scores: labels are verbatim and consistent with the evaluators
    - test_heading_split_matches_labels_without_the_agent: deterministic cases need no LLM
    - test_reworded_bullet_fails_verbatim_check: the verbatim check catches rewording
"""

from types import SimpleNamespace

from evals.job_posting_extraction_evaluators import VerbatimBullets
from evals.run_job_posting_extraction_evals import (
    linkedin_case_to_page,
    load_job_posting_extraction_dataset,
)
from job_postings.extract_job_posting import BulletSortingRun, extract_job_posting
from schemas.scraped_job_posting import ScrapedJobPosting


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case its own expected output scores 1.0 everywhere."""
    dataset = load_job_posting_extraction_dataset()
    labels = {case.inputs["job_id"]: case.expected_output for case in dataset.cases}

    report = dataset.evaluate_sync(lambda inputs: labels[inputs["job_id"]], progress=False)

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores


def test_heading_split_matches_labels_without_the_agent() -> None:
    """Cases labelled 'headings' or 'none' are fully handled without calling the sorter."""

    def never_called(_bullets: list[str]) -> BulletSortingRun:
        """Fails if the fallback runs."""
        raise AssertionError("the sorting agent should not run")

    deterministic_cases = [
        case
        for case in load_job_posting_extraction_dataset().cases
        if case.expected_output and case.expected_output.requirements_sorted_by != "llm"
    ]

    assert deterministic_cases
    for case in deterministic_cases:
        posting = extract_job_posting(linkedin_case_to_page(case.inputs), never_called).posting
        expected = case.expected_output
        assert expected is not None
        assert posting.requirements == expected.requirements, case.name
        assert posting.responsibilities == expected.responsibilities, case.name
        assert posting.nice_to_haves == expected.nice_to_haves, case.name
        assert posting.requirements_sorted_by == expected.requirements_sorted_by, case.name


def test_reworded_bullet_fails_verbatim_check() -> None:
    """A requirement that isn't in the posting's text is flagged."""
    output = ScrapedJobPosting(
        source="linkedin",
        source_url="https://www.linkedin.com/jobs/view/1/",
        title="Engineer",
        company="Acme",
        requirements=["5+ years of Python", "Expert in Rust"],
        requirements_sorted_by="llm",
    )
    context = SimpleNamespace(
        inputs={"description_html": "<ul><li>5+ years of Python</li><li>Rust</li></ul>"},
        output=output,
    )

    scores = VerbatimBullets().evaluate(context)  # type: ignore[arg-type]

    assert scores["verbatim_bullets"] == 0.5
