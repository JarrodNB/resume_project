"""Select exact saved career text for candidate-facing interview references.

Query embeddings and hybrid search reuse the library index. Display text comes
from the user's saved records, never a stale vector row or a generated answer.
Bare skill records are excluded; substantive saved examples can still mention skills.
"""
import asyncio
from uuid import UUID

from pydantic import BaseModel, Field

from database.library_embedding_search import search_career_library
from database.open_read_only_connection import open_read_only_connection
from memory.embed_search_query import embed_search_query_async
from settings import DEFAULT_INTERVIEW_REFERENCE_MIN_SIMILARITY

SELECTION_POLICY_VERSION = "interview-references-v5"

SOURCE_TYPES = frozenset({"Experience", "ExperienceHighlight", "Project", "Education", "Certification", "CareerContext"})


class CareerReference(BaseModel):
    """A bounded piece of saved user evidence, not model-written guidance."""
    source_type: str
    source_id: UUID
    title: str = Field(min_length=1, max_length=280)
    body: str = Field(min_length=1, max_length=4000)


def saved_reference_sources(library):
    """Project owned library records into exact display bodies; exclude career context requirements."""
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
    for context in library.career_contexts:
        add("CareerContext", context, "Saved career context", context.response)
    return sources


def reference_index_texts(library):
    """Rebuild Rails' saved embedding prose for one-time vector compatibility.

    Keep this projection aligned with CareerLibrary::BuildEmbeddingTextsService.
    Whitespace is normalized for comparison only; display bodies stay untouched.
    A stale vector is ignored until Rails refreshes the index.
    """
    texts = {}

    def add(kind, record, text):
        texts[(kind, record.id)] = " ".join(text.split())

    def details(heading, body):
        return f"{heading}: {body}" if body and body.strip() else heading

    for role in library.experiences:
        title = f"{role.title} at {role.company}"
        heading = f"{title} ({role.location})" if role.location and role.location.strip() else title
        add("Experience", role, details(heading, role.description))
        for highlight in role.highlights:
            add("ExperienceHighlight", highlight, f"{title}: {highlight.content}")
    for project in library.projects:
        heading = f"Project: {project.name}"
        if project.role and project.role.strip():
            heading += f" ({project.role})"
        add("Project", project, details(heading, project.description))
    for education in library.educations:
        degree = " in ".join(part for part in (education.degree, education.field_of_study) if part and part.strip())
        heading = ", ".join(part for part in (degree, education.institution) if part and part.strip())
        add("Education", education, details(heading, education.description))
    for certification in library.certifications:
        fields = [f"Certification: {certification.name}"]
        for field in ("issuer", "issued_date", "expiry_date", "credential_id", "credential_url"):
            value = getattr(certification, field)
            if value is None or (isinstance(value, str) and not value.strip()):
                continue
            if field in ("issued_date", "expiry_date"):
                value = value.strftime({"year": "%Y", "month": "%Y-%m", "day": "%Y-%m-%d"}[
                    getattr(certification, f"{field}_precision")])
            fields.append(f"{field.replace('_', ' ').capitalize()}: {value}")
        add("Certification", certification, details(", ".join(fields), certification.description))
    # Match Rails’ retained embedding text prefix; source identity uses CareerContext.
    for context in library.career_contexts:
        add("CareerContext", context, f"Fact: {context.requirement}: {context.response}")
    return texts


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
    return select_references(library, question_text, matches,
        min_similarity=settings.interview_reference_min_similarity), embedded.usage


def select_references(library, query_text, matches, *,
                      min_similarity=DEFAULT_INTERVIEW_REFERENCE_MIN_SIMILARITY):
    """Return distinct saved sources whose current vectors meet minimum similarity.

    The search already supplies hybrid ordering. Keyword matches cannot bypass
    the similarity cutoff, and unindexed or stale-index sources are ineligible.
    The threshold is a policy heuristic, not calibrated relevance confidence.
    """
    sources = saved_reference_sources(library)
    groups = {key: key for key in sources}
    for role in library.experiences:
        for highlight in role.highlights:
            groups[("ExperienceHighlight", highlight.id)] = ("Experience", role.id)
    current_index_text = reference_index_texts(library)
    vector_keys = [(match.source_type, match.source_id) for match in matches
                   if 1 - match.distance >= min_similarity and (match.source_type, match.source_id) in sources
                   and " ".join(match.content.split()) == current_index_text[(match.source_type, match.source_id)]]
    ordered = list(dict.fromkeys(vector_keys))
    # Keep search rank within each class, but concrete highlights/narratives precede
    # role descriptions; a role plus its bullets consumes one card.
    priority = {"ExperienceHighlight": 0, "Project": 0, "CareerContext": 0, "Experience": 1}
    ordered.sort(key=lambda key: priority.get(key[0], 1))
    selected, seen_groups, seen_bodies = [], set(), set()
    for key in ordered:
        reference = sources[key]
        body_key = " ".join(reference.body.lower().split())
        if groups[key] in seen_groups or body_key in seen_bodies:
            continue
        selected.append(reference)
        seen_groups.add(groups[key])
        seen_bodies.add(body_key)
        if len(selected) == 3:
            break
    return selected
