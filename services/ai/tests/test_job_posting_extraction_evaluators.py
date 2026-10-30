"""
Description: Sanity checks for the job posting extraction eval dataset and evaluators (no LLM
calls): hand labels score 1.0 and scrape provenance survives conversion.
Index:
    - test_hand_labels_get_perfect_scores: labels are verbatim and consistent with the evaluators
    - test_labels_pass_the_production_scraped_ad_builder: source/provenance mapping
    - test_reworded_bullet_fails_verbatim_check: the verbatim check catches rewording
"""

from types import SimpleNamespace

import pytest

from evals.job_posting_extraction_evaluators import VerbatimBullets
from evals.run_job_posting_extraction_evals import (
    linkedin_case_to_page,
    load_job_posting_extraction_dataset,
)
from job_postings.scraped_job_ad import posting_from_scraped_ad
from schemas.parsed_job_posting import ParsedJobPosting
from schemas.scraped_job_posting import ScrapedJobPosting


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case its own expected output scores 1.0 everywhere."""
    dataset = load_job_posting_extraction_dataset()
    labels = {case.inputs["job_id"]: case.expected_output for case in dataset.cases}

    report = dataset.evaluate_sync(lambda inputs: labels[inputs["job_id"]], progress=False)

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores


def test_labels_pass_the_production_scraped_ad_builder() -> None:
    """Expected source spans survive conversion, including prose-only qualifications."""
    for case in load_job_posting_extraction_dataset().cases:
        expected = case.expected_output
        assert expected is not None
        parsed = ParsedJobPosting(
            title=expected.title, company=expected.company,
            requirements=expected.requirements, responsibilities=expected.responsibilities,
            nice_to_haves=expected.nice_to_haves,
        )
        posting = posting_from_scraped_ad(linkedin_case_to_page(case.inputs), parsed)
        assert posting.requirements == expected.requirements, case.name
        assert posting.responsibilities == expected.responsibilities, case.name
        assert posting.nice_to_haves == expected.nice_to_haves, case.name
        assert posting.source_url == expected.source_url, case.name
        assert posting.requirements_sorted_by == expected.requirements_sorted_by, case.name


def test_extraction_runner_uses_shared_parser_and_scraped_conversion(monkeypatch):
    """The maintained quality runner follows the production parsing path, not legacy sorting."""
    from pydantic_ai.usage import RunUsage

    from agents.parse_job_posting_agent import JobPostingParseRun
    from evals import run_job_posting_extraction_evals as runner

    case = next(
        case for case in load_job_posting_extraction_dataset().cases
        if case.name == "prose_only_no_bullets"
    )
    expected = case.expected_output
    calls = []

    def parse(text, **kwargs):
        calls.append((text, kwargs))
        return JobPostingParseRun(ParsedJobPosting(
            title=expected.title, company=expected.company,
            requirements=expected.requirements, responsibilities=expected.responsibilities,
        ), RunUsage())

    def evaluate(load_dataset, task, **kwargs):
        return task(case.inputs)

    monkeypatch.setattr(runner, "parse_scraped_job_posting", parse)
    monkeypatch.setattr(runner, "evaluate_dataset", evaluate)
    posting = runner.run_job_posting_extraction_evals(model_override="openai:gpt-5-mini")
    assert posting.requirements == expected.requirements
    assert posting.responsibilities == expected.responsibilities
    assert posting.source_url == expected.source_url
    assert calls[0][1]["model"] == "openai:gpt-5-mini"
    assert calls[0][1]["fallback_model"] == "openai:gpt-5-mini"
    assert "Title: Office Manager" in calls[0][0]


def test_injection_labels_are_consistent_and_source_supported():
    from evals.run_job_posting_extraction_evals import DATASET_PATH

    dataset = load_job_posting_extraction_dataset(
        DATASET_PATH.with_name("job_posting_injection_cases.yaml"),
    )
    labels = {case.inputs["job_id"]: case.expected_output for case in dataset.cases}
    report = dataset.evaluate_sync(lambda inputs: labels[inputs["job_id"]], progress=False)
    assert len(report.cases) == 10
    assert all(value == 1.0 for value in report.averages().scores.values())


@pytest.mark.parametrize("invented", [False, True])
def test_source_only_extraction_keeps_validation_without_a_classifier(
    invented, task_dependencies, monkeypatch,
):
    from pydantic_ai.exceptions import UnexpectedModelBehavior
    from pydantic_ai.models.test import TestModel
    from pydantic_ai_harness import InputGuardrail

    from agents.parse_scraped_job_posting_agent import (
        parse_scraped_job_posting,
        parse_scraped_job_posting_agent,
    )
    from evals.run_job_posting_extraction_evals import with_extraction_screening
    from job_postings.scraped_job_ad import scraped_job_ad_text

    def never_screen(*args, **kwargs):
        raise AssertionError("Screening was not disabled in the eval experiment")

    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", never_screen)
    guards = [cap for cap in parse_scraped_job_posting_agent._root_capability.capabilities
              if isinstance(cap, InputGuardrail)]
    original_guard = guards[0].guard
    case = load_job_posting_extraction_dataset().cases[0]
    page = linkedin_case_to_page(case.inputs)
    output = {"title": page.title, "company": page.company,
              "requirements": ["Invented COBOL requirement"] if invented
              else case.expected_output.requirements}
    with with_extraction_screening():
        assert guards[0].guard is not original_guard
    assert guards[0].guard is original_guard
    with parse_scraped_job_posting_agent.override(model=TestModel(custom_output_args=output)):
        if invented:
            with pytest.raises(UnexpectedModelBehavior):
                parse_scraped_job_posting(
                    scraped_job_ad_text(page), model=task_dependencies.settings.job_posting_parse_model,
                    thinking=False, timeout_seconds=10,
                fallback_model=task_dependencies.settings.job_posting_parse_model,
                )
        else:
            run = parse_scraped_job_posting(
                scraped_job_ad_text(page), model=task_dependencies.settings.job_posting_parse_model,
                thinking=False, timeout_seconds=10,
                fallback_model=task_dependencies.settings.job_posting_parse_model,
            )
            assert posting_from_scraped_ad(page, run.parsed).requirements == output["requirements"]
    assert guards[0].guard is original_guard


def test_source_checks_cannot_detect_category_poisoning():
    """A source-supported phrase can still be assigned to the wrong category."""
    from evals.run_job_posting_extraction_evals import DATASET_PATH

    dataset = load_job_posting_extraction_dataset(
        DATASET_PATH.with_name("job_posting_injection_cases.yaml"),
    )
    case = next(case for case in dataset.cases if case.name == "optional_to_required")
    page = linkedin_case_to_page(case.inputs)
    poisoned = ParsedJobPosting(
        title=page.title, company=page.company, requirements=["Go experience is preferred."],
    )
    # This is an accepted bad output, not evidence that the model actually follows the attack.
    posting = posting_from_scraped_ad(page, poisoned)
    assert posting.requirements == ["Go experience is preferred."]
    score = VerbatimBullets().evaluate(SimpleNamespace(inputs=case.inputs, output=posting))
    assert score["verbatim_bullets"] == 1.0


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
