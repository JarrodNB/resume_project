"""Bind tailoring's labeled views to the complete saved units that were checked.

A safe role entry may supply several labels. Those views never become generally approved
strings: exact prompt binding reconstructs them from the canonical checked JSON instead.
"""

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from schemas.gap_analysis_context import GapAnalysisContext, JobToAnalyze
from screening.job_inputs import rebuild_job
from screening.library_inputs import rebuild_library
from screening.session import bind_screened_prompt
from tailoring.build_section_prompt import job_context_text
from tailoring.labeled_sources import label_sources


@dataclass(frozen=True)
class SourceProjection:
    """One prompt value derived exclusively from supplied classifier source values."""

    sources: tuple[str, ...]
    render: Callable[[Sequence[str]], str]


def job_projection(sources: tuple[str, ...]) -> SourceProjection:
    """Use the same complete saved job unit as gap analysis, then select tailoring fields."""
    return SourceProjection(sources, lambda values: job_context_text(
        GapAnalysisContext(job=rebuild_job(values), career_library={}),
    ))


def library_projections(sources: Sequence[str], fields: Sequence[str]) -> dict[str, SourceProjection]:
    """Derive labeled views, preserving original IDs and never carrying unchecked prose."""
    # The minimal job is application-owned scaffolding. This only describes projections;
    # the preparation boundary must check their sources before retaining them.
    result = {}
    for source, field in zip(sources, fields, strict=True):
        if field == "fact_requirement":
            continue
        units, layout = [source], [field]
        if field == "facts":
            identifier = json.loads(source)["id"]
            for other, other_field in zip(sources, fields, strict=True):
                if other_field == "fact_requirement" and json.loads(other)["id"] == identifier:
                    units.append(other)
                    layout.append(other_field)

        def records(values, layout=tuple(layout)):
            rebuilt = GapAnalysisContext(job=JobToAnalyze(id="", title=""),
                career_library=rebuild_library(values, layout))
            return label_sources(rebuilt, [], [], None).records

        for label, record in records(units).items():
            def project(values, label=label, records=records):
                return records(values)[label].text
            result[record.text] = SourceProjection(tuple(units), project)
    return result


def bind_projected_prompt(values, render, projections: dict[str, SourceProjection]) -> str:
    """Reconstruct every projected value from allowed units before exact prompt binding."""
    units = []
    layouts = []
    for value in values:
        projection = projections.get(value, SourceProjection((value,), lambda texts: texts[0]))
        start = len(units)
        units.extend(projection.sources)
        layouts.append((start, len(units), projection.render))

    def reconstruct(approved):
        return render([project(approved[start:end]) for start, end, project in layouts])

    return bind_screened_prompt(units, reconstruct)
