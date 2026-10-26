"""Report synthetic interview-reference selection using the production policy.

Default execution is offline: vector distances are fixture inputs, not measured
semantic similarity. Optional --paid embeds synthetic evidence and queries through
the existing traced/accounted embedding helper; it does not call a dialogue model.
Reports print to stdout; only --output saves a file. Neither mode changes admission.
"""
import argparse
import json
from pathlib import Path

from interviews.references import (
    SELECTION_POLICY_VERSION,
    saved_reference_sources,
    select_references,
)
from schemas.gap_analysis_context import CareerLibrary
from schemas.library_search_match import LibrarySearchMatch

DATASET = Path(__file__).parent / "datasets" / "interview_reference_cases.json"


def evaluate_case(case, *, matches=None):
    """Evaluate observable source selection, preserving outputs on failed labels."""
    library = CareerLibrary.model_validate(case["library"])
    ranked = [LibrarySearchMatch.model_validate(match) for match in case.get("matches", [])] if matches is None else matches
    selected = select_references(library, case["query"], ranked)
    ids = [str(reference.source_id) for reference in selected]
    expected = case["expected_ids"]
    return {"name": case["name"], "selected_ids": ids, "expected_ids": expected,
            "passed": ids == expected, "references": [reference.model_dump(mode="json") for reference in selected]}


def paid_matches(case, settings):
    """Supply real distances in production hybrid order without requiring a database.

    Synthetic documents use readable source heading/body plus fact requirement labels.
    This tests selection at its input seam; it does not benchmark Postgres query latency.
    """
    from evals.run_library_retrieval_evals import _cosine_similarity
    from memory.embed_search_query import embed_search_query
    from memory.hybrid_rank import RankedDocument, hybrid_order

    library = CareerLibrary.model_validate(case["library"])
    sources = saved_reference_sources(library)
    if not sources:
        return []
    facts = {fact.id: fact.requirement for fact in library.facts}
    documents = []
    lookup = {}
    query = embed_search_query(case["query"], settings.embedding_model, settings.embedding_dimensions)
    for index, ((kind, source_id), reference) in enumerate(sources.items()):
        text = f"{reference.title}: {reference.body}"
        if kind == "LibraryFact":
            text = f"Fact: {facts[source_id]}: {reference.body}"
        embedded = embed_search_query(text, settings.embedding_model, settings.embedding_dimensions)
        distance = 1 - _cosine_similarity(query.vector, embedded.vector)
        key = str(index)
        documents.append(RankedDocument(key, text, distance))
        lookup[key] = (kind, source_id, text, distance)
    documents.sort(key=lambda item: item.distance)
    return [LibrarySearchMatch(source_type=lookup[key][0], source_id=lookup[key][1], content=lookup[key][2],
                               distance=lookup[key][3], score=score)
            for key, score in hybrid_order(documents, case["query"])[:12]]


def run_evaluation(*, paid=False):
    """Keep fixture agreement and real-embedding label metrics explicitly separate."""
    cases = json.loads(DATASET.read_text())
    results = []
    usage = None
    if paid:
        from evals.telemetry import eval_run, record_score
        from worker.settings import load_settings
        from worker.task_usage import collect_task_usage
        from worker.tracing import configure_tracing

        settings = load_settings()
        configure_tracing()
        with eval_run("evals.interview_references", metadata={"mode": "real_embeddings", "model": settings.embedding_model},
                      version=SELECTION_POLICY_VERSION), collect_task_usage() as usage:
            for case in cases:
                results.append(evaluate_case(case, matches=paid_matches(case, settings)))
            record_score("exact_label_agreement", sum(case["passed"] for case in results) / len(results))
    else:
        results = [evaluate_case(case) for case in cases]
    return {"mode": "real_embeddings" if paid else "offline_policy", "policy_version": SELECTION_POLICY_VERSION,
            "provider_requests": sum(1 for _ in usage.entries) if usage else 0,
            "usage_incomplete": usage.incomplete if usage else False,
            "usage": [entry.model_dump(mode="json") for entry in usage.entries] if usage else [],
            "semantic_relevance": {"exact_label_agreement": sum(case["passed"] for case in results) / len(results)} if paid else None,
            "limitation": "Small synthetic fixture set; no judge or human relevance measurement. Offline distances are supplied, not measured. Paid corpus heading/body text approximates Rails indexing; this is selection-seam evidence, not exact production indexing or latency evidence.",
            "cases": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paid", action="store_true", help="Explicitly enable cost-bearing embedding requests on synthetic data")
    parser.add_argument("--output", type=Path, help="Save the JSON report at this path; otherwise print only")
    args = parser.parse_args()
    report = run_evaluation(paid=args.paid)
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered)
    print(rendered, end="")
    # A failed label is evidence to investigate, never silently reclassify as success.
    return 0 if all(case["passed"] for case in report["cases"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
