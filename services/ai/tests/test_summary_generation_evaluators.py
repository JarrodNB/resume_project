"""Check the bounded synthetic suite and citation evaluator failure paths offline."""
from types import SimpleNamespace

from evals.run_summary_generation_evals import (
    SummaryCitationValidity,
    load_summary_generation_dataset,
)


def test_cases_cover_full_sparse_and_negative_evidence():
    cases = load_summary_generation_dataset().cases
    assert {case.name for case in cases} == {"backend_evidence", "education_only", "negative_context_is_not_qualification"}
    assert all(not source.screened for case in cases for source in case.inputs.sources)


def test_evaluator_rejects_unknown_and_missing_citations():
    case = load_summary_generation_dataset().cases[0]
    evaluator = SummaryCitationValidity()
    for labels in ([], ["UNKNOWN"], ["EXPERIENCES_1_TITLE"] * 2):
        scores = evaluator.evaluate(SimpleNamespace(inputs=case.inputs, output={"text": "Engineer", "source_labels": labels}))
        assert scores["summary_contract"] == 0.0
    assert evaluator.evaluate(SimpleNamespace(inputs=case.inputs, output={"text": "Engineer", "source_labels": ["EXPERIENCES_1_TITLE"]}))["summary_contract"] == 1.0
