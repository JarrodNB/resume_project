"""Keep reusable saved-job fields separate from optional responsibility context.

The base source is identical for gap analysis and tailoring. Extra responsibilities must
receive their own check; a base approval never covers additional untrusted values.
"""

import json
from collections.abc import Sequence

from schemas.gap_analysis_context import JobToAnalyze


def job_source_values(job: JobToAnalyze, *, include_responsibilities: bool = False) -> tuple[str, ...]:
    """Return exact classifier sources without granting saved provenance or approval."""
    base = job.model_dump_json(exclude_none=True, exclude={"responsibilities"})
    if include_responsibilities and job.responsibilities:
        return (base, json.dumps({"responsibilities": job.responsibilities}, separators=(",", ":")))
    return (base,)


def rebuild_job(sources: Sequence[str]) -> JobToAnalyze:
    """Reconstruct a saved job exclusively from checked source values."""
    content = json.loads(sources[0])
    if len(sources) == 2:
        content.update(json.loads(sources[1]))
    elif len(sources) != 1:
        raise ValueError("Job source layout does not match its values")
    return JobToAnalyze.model_validate(content)
