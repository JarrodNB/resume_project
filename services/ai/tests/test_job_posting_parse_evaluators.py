"""
Description: Sanity checks for the pasted job-ad eval dataset and evaluators (no LLM calls).
Index:
    - test_hand_labels_get_perfect_scores: labels are verbatim and consistent with the evaluators
    - test_faithful_parse_matches_labels: the posting builder matches the labels
    - test_invented_bullet_fails_verbatim_check: an extra bullet scores below 1
"""

from evals.job_posting_parse_evaluators import PastedVerbatim
from evals.run_job_posting_parse_evals import load_job_posting_parse_dataset
from job_postings.posting_from_parsed_job import posting_from_parsed_job
from schemas.parsed_job_posting import ParsedJobPosting
from schemas.scraped_job_posting import ScrapedJobPosting


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case its own expected output scores 1.0 everywhere."""
    dataset = load_job_posting_parse_dataset()
    labels = {case.name: case.expected_output for case in dataset.cases}

    report = dataset.evaluate_sync(lambda inputs: labels[_name_for(dataset, inputs)], progress=False)

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores


def test_faithful_parse_matches_labels() -> None:
    """Building a posting from the labelled fields, without a model, matches the labels."""
    dataset = load_job_posting_parse_dataset()

    def from_label(inputs: dict[str, object]) -> ScrapedJobPosting:
        """The production builder, fed the case's own expected fields."""
        expected = _label(dataset, inputs)
        assert expected is not None
        parsed = ParsedJobPosting(
            title=expected.title,
            company=expected.company,
            location=expected.location,
            url=expected.source_url or None,
            requirements=list(expected.requirements),
            responsibilities=list(expected.responsibilities),
            nice_to_haves=list(expected.nice_to_haves),
        )
        return posting_from_parsed_job(str(inputs["text"]), parsed)

    report = dataset.evaluate_sync(from_label, progress=False)

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores


def test_invented_bullet_fails_verbatim_check() -> None:
    """A requirement that is not in the ad does not score a perfect verbatim check."""
    dataset = load_job_posting_parse_dataset()
    case = dataset.cases[0]
    expected = case.expected_output
    assert isinstance(expected, ScrapedJobPosting)
    invented = expected.model_copy(update={"requirements": ["10 years of COBOL"], "nice_to_haves": []})
    context = type("Context", (), {"inputs": case.inputs, "output": invented, "expected_output": expected})()

    score = PastedVerbatim().evaluate(context)  # type: ignore[arg-type]

    assert score["verbatim_bullets"] == 0.0


def _label(dataset: object, inputs: dict[str, object]) -> ScrapedJobPosting | None:
    """The expected posting for this paste."""
    text = inputs["text"]
    for case in dataset.cases:  # type: ignore[attr-defined]
        if case.inputs["text"] == text:
            return case.expected_output
    return None


def _name_for(dataset: object, inputs: dict[str, object]) -> str:
    """The case name for this paste."""
    text = inputs["text"]
    for case in dataset.cases:  # type: ignore[attr-defined]
        if case.inputs["text"] == text:
            return case.name
    raise KeyError(text)
