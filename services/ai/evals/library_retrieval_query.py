"""Stable synthetic retrieval benchmark queries, independent of resume generation.

The benchmark keeps its historical eight-result cutoff so scores remain comparable.
Resume generation uses the complete library and does not call retrieval.
"""

from schemas.gap_analysis_context import JobToAnalyze

RETRIEVAL_LIMIT = 8
_FOCUS = {
    "summary": "professional summary",
    "experience": "work experience and achievements",
    "projects": "projects",
    "certifications": "certifications and professional credentials",
    "education": "education and degrees",
    "skills": "skills and tools",
}


def section_query(section_type: str, job: JobToAnalyze) -> str:
    """Build a benchmark query from its focus, role and job requirements."""
    requirements = "\n".join([*job.requirements, *job.nice_to_haves])
    return f"{_FOCUS[section_type]}\n{job.title} at {job.company or 'Unknown company'}\n{requirements}"
