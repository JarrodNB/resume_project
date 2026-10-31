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
    reference_index_texts,
    saved_reference_sources,
    select_references,
)
from schemas.gap_analysis_context import CareerLibrary
from schemas.library_search_match import LibrarySearchMatch
from settings import DEFAULT_INTERVIEW_REFERENCE_MIN_SIMILARITY, load_settings

DATASET = Path(__file__).parent / "datasets" / "interview_reference_cases.json"


def evaluate_case(case, *, matches=None, min_similarity=DEFAULT_INTERVIEW_REFERENCE_MIN_SIMILARITY):
    """Evaluate observable source selection, preserving outputs on failed labels."""
    library = CareerLibrary.model_validate(case["library"])
    ranked = [LibrarySearchMatch.model_validate(match) for match in case.get("matches", [])] if matches is None else matches
    selected = select_references(library, case["query"], ranked, min_similarity=min_similarity)
    ids = [str(reference.source_id) for reference in selected]
    expected = case["expected_ids"]
    return {"name": case["name"], "selected_ids": ids, "expected_ids": expected,
            "passed": ids == expected, "references": [reference.model_dump(mode="json") for reference in selected]}


def paid_matches(case, settings):
    """Supply real distances in production hybrid order without requiring a database.

    Synthetic documents reuse the production index compatibility projection for every source.
    This tests selection at its input seam; it does not benchmark Postgres query latency.
    """
    from evals.run_library_retrieval_evals import _cosine_similarity
    from memory.embed_search_query import embed_search_query
    from memory.hybrid_rank import RankedDocument, hybrid_order

    library = CareerLibrary.model_validate(case["library"])
    sources = saved_reference_sources(library)
    if not sources:
        return []
    index_text = reference_index_texts(library)
    documents = []
    lookup = {}
    query = embed_search_query(case["query"], settings.embedding_model, settings.embedding_dimensions)
    for index, (kind, source_id) in enumerate(sources):
        text = index_text[(kind, source_id)]
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
    settings = load_settings()
    min_similarity = settings.interview_reference_min_similarity
    cases = json.loads(DATASET.read_text())
    results = []
    usage = None
    if paid:
        from evals.telemetry import eval_run, record_score
        from llm.usage import collect_task_usage
        from telemetry.tracing import configure_tracing

        configure_tracing()
        with eval_run("evals.interview_references", metadata={"mode": "real_embeddings", "model": settings.embedding_model, "min_similarity": min_similarity},
                      version=SELECTION_POLICY_VERSION), collect_task_usage() as usage:
            for case in cases:
                results.append(evaluate_case(case, matches=paid_matches(case, settings), min_similarity=min_similarity))
            record_score("exact_label_agreement", sum(case["passed"] for case in results) / len(results))
    else:
        results = [evaluate_case(case, min_similarity=min_similarity) for case in cases]
    return {"mode": "real_embeddings" if paid else "offline_policy", "policy_version": SELECTION_POLICY_VERSION,
            "min_similarity": min_similarity,
            "provider_requests": sum(1 for _ in usage.entries) if usage else 0,
            "usage_incomplete": usage.incomplete if usage else False,
            "usage": [entry.model_dump(mode="json") for entry in usage.entries] if usage else [],
            "semantic_relevance": {"exact_label_agreement": sum(case["passed"] for case in results) / len(results)} if paid else None,
            "limitation": "Small synthetic fixture set; no judge or human relevance measurement. Offline distances are supplied, not measured. Paid corpus uses the production index compatibility projection; this is selection-seam evidence, not Postgres indexing or latency evidence.",
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
