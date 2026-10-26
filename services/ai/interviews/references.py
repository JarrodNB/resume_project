"""Select exact saved career text for candidate-facing interview references.

Query embeddings and hybrid search reuse the library index. Display text comes
from the user's saved records, never a stale vector row or a generated answer.
"""
import asyncio
from uuid import UUID

from pydantic import BaseModel, Field

from database.library_embedding_search import search_career_library
from database.open_read_only_connection import open_read_only_connection
from memory.embed_search_query import embed_search_query_async

SOURCE_TYPES = frozenset({"Experience", "ExperienceHighlight", "Project", "Education", "Certification", "Skill", "LibraryFact"})


class CareerReference(BaseModel):
    """A bounded piece of saved user evidence, not model-written guidance."""
    source_type: str
    source_id: UUID
    title: str = Field(min_length=1, max_length=280)
    body: str = Field(min_length=1, max_length=4000)


def saved_reference_sources(library):
    """Project owned library records into exact display bodies; exclude fact requirements."""
    sources = {}

    def add(kind, record, title, body):
        if body and body.strip() and len(body) <= 4000:
            sources[(kind, record.id)] = CareerReference(source_type=kind, source_id=record.id,
                title=title[:280], body=body)

    for role in library.experiences:
        title = f"{role.title} at {role.company}"
        add("Experience", role, title, role.description)
        for highlight in role.highlights:
            add("ExperienceHighlight", highlight, title, highlight.content)
    for project in library.projects:
        add("Project", project, project.name, project.description)
    for education in library.educations:
        add("Education", education, education.institution,
            education.description or education.degree or education.field_of_study)
    for certification in library.certifications:
        add("Certification", certification, certification.name, certification.description or certification.name)
    for skill in library.skills:
        add("Skill", skill, skill.category or "Saved skill", skill.name)
    for fact in library.facts:
        add("LibraryFact", fact, "Saved career fact", fact.response)
    return sources


def retrieve_references(user_id, question_text, settings, library):
    """Return up to three current saved sources and the single embedding's usage.

    Missing source rows or an empty index yield no references. This does not embed
    the user's library during an interview; Rails maintains that derived index.
    """
    sources = saved_reference_sources(library)
    if not sources:
        return [], None

    async def embed():
        async with asyncio.timeout(min(settings.llm_run_timeout_seconds, 30)):
            return await embed_search_query_async(question_text, settings.embedding_model, settings.embedding_dimensions)

    embedded = asyncio.run(embed())
    with open_read_only_connection(settings) as connection:
        matches = search_career_library(connection, user_id, embedded.vector, question_text,
            settings.embedding_model, limit=12, source_types=SOURCE_TYPES)
    references = []
    seen = set()
    for match in matches:
        key = (match.source_type, match.source_id)
        if key in sources and key not in seen:
            references.append(sources[key])
            seen.add(key)
        if len(references) == 3:
            break
    return references, embedded.usage
