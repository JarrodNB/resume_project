"""Offline policy evidence must not masquerade as provider relevance measurement."""
from evals.run_interview_reference_evals import run_evaluation


def test_offline_report_uses_production_policy_and_separates_semantic_evidence():
    from interviews.references import SELECTION_POLICY_VERSION

    report = run_evaluation()
    assert report["policy_version"] == SELECTION_POLICY_VERSION
    assert report["mode"] == "offline_policy"
    assert report["provider_requests"] == 0
    assert report["semantic_relevance"] is None
    assert len(report["cases"]) >= 8
    assert all(case["passed"] for case in report["cases"])
    assert any(case["selected_ids"] == [] for case in report["cases"])


def test_failed_expectation_is_reported_without_hiding_actual_selection():
    from evals.run_interview_reference_evals import evaluate_case

    result = evaluate_case({"name": "deliberately wrong", "query": "Kubernetes", "library": {},
                            "matches": [], "expected_ids": ["00000000-0000-0000-0000-000000000001"]})
    assert result["passed"] is False
    assert result["selected_ids"] == []


def test_paid_mode_reports_embedding_usage_and_label_metrics_at_fake_provider_seam(monkeypatch):
    from contextlib import nullcontext
    from types import SimpleNamespace

    from pydantic_ai.usage import RequestUsage

    from memory.embed_search_query import QueryEmbedding
    from worker.task_usage import current_task_usage

    monkeypatch.setattr("worker.settings.load_settings", lambda: SimpleNamespace(
        embedding_model="openai:text-embedding-3-small", embedding_dimensions=2))
    monkeypatch.setattr("worker.tracing.configure_tracing", lambda: None)
    monkeypatch.setattr("evals.telemetry.eval_run", lambda *args, **kwargs: nullcontext())
    monkeypatch.setattr("evals.telemetry.record_score", lambda *args: None)

    def fake_embed(text, model, dimensions):
        usage = RequestUsage(input_tokens=8)
        current_task_usage().record(model, usage)
        return QueryEmbedding([1.0, 0.0], usage)

    monkeypatch.setattr("memory.embed_search_query.embed_search_query", fake_embed)
    report = run_evaluation(paid=True)
    assert report["mode"] == "real_embeddings"
    assert report["provider_requests"] > 0
    assert len(report["usage"]) == report["provider_requests"]
    assert all(entry["cost_microdollars"] > 0 for entry in report["usage"])
    assert 0 <= report["semantic_relevance"]["exact_label_agreement"] <= 1
    assert "approximates Rails" in report["limitation"]
