"""
Description: Embeds one section's query (the section plus that job's requirements) and
returns the library rows hybrid search ranks highest. An empty result means the caller
should use the whole library, which is what happens before any embeddings exist.
Index:
    - section_query: the text embedded for one section
    - retrieve_source_keys: (Rails class name, id) of the closest rows, or None when there
      are none
"""

from uuid import UUID

from database.library_embedding_search import search_career_library
from database.open_read_only_connection import open_read_only_connection
from memory.embed_search_query import embed_search_query, stored_embedding_model_name
from schemas.gap_analysis_context import JobToAnalyze
from worker.model_prices import build_model_usage
from worker.queue_messages import ModelUsage
from worker.settings import WorkerSettings

_FOCUS = {
    "summary": "professional summary",
    "experience": "work experience and achievements",
    "projects": "projects",
    "certifications": "certifications and professional credentials",
    "education": "education and degrees",
    "skills": "skills and tools",
}
_LIMIT = 8
# Preserve mixed career evidence for summary/experience; new types require an explicit choice.
_SOURCE_TYPES = frozenset(
    {
        "Experience",
        "ExperienceHighlight",
        "Project",
        "Education",
        "Certification",
        "Skill",
        "LibraryFact",
    }
)


def section_query(section_type: str, job: JobToAnalyze) -> str:
    """The search text for one section: its focus, the role, and the job's requirements."""
    requirements = "\n".join([*job.requirements, *job.nice_to_haves])
    return f"{_FOCUS[section_type]}\n{job.title} at {job.company or 'Unknown company'}\n{requirements}"


def retrieve_source_keys(
    user_id: UUID, section_type: str, job: JobToAnalyze, settings: WorkerSettings
) -> tuple[set[tuple[str, str]] | None, ModelUsage | None]:
    """Returns the closest library rows and the embedding call's usage. None rows means
    use the whole library."""
    query = section_query(section_type, job)
    embedded = embed_search_query(query, settings.embedding_model, settings.embedding_dimensions)
    usage = build_model_usage(settings.embedding_model, embedded.usage)
    with open_read_only_connection(settings) as connection:
        matches = search_career_library(
            connection,
            user_id,
            embedded.vector,
            query,
            stored_embedding_model_name(settings.embedding_model),
            limit=_LIMIT,
            source_types=_SOURCE_TYPES,
        )
    if not matches:
        return None, usage
    return {(match.source_type, match.source_id) for match in matches}, usage
