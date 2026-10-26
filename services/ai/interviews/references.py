"""Select exact saved career text for candidate-facing interview references.

Query embeddings and hybrid search reuse the library index. Display text comes
from the user's saved records, never a stale vector row or a generated answer.
"""
import asyncio
import re
from uuid import UUID

from pydantic import BaseModel, Field

from database.library_embedding_search import search_career_library
from database.open_read_only_connection import open_read_only_connection
from memory.embed_search_query import embed_search_query_async
from memory.hybrid_rank import keyword_rank

SELECTION_POLICY_VERSION = "interview-references-v2"
MAX_SOURCES = 500
MAX_VECTOR_DISTANCE = 0.35  # Conservative initial policy; semantic calibration is release-gated.
_QUERY_BOILERPLATE = frozenset(["a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "describe", "did", "do", "experience", "explain", "for", "from", "had", "have", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "please", "role", "tell", "that", "the", "their", "them", "there", "these", "they", "this", "to", "was", "were", "what", "when", "where", "which", "who", "why", "will", "with", "work", "would", "you", "your", "about", "example", "time", "situation"])

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
        if len(sources) < MAX_SOURCES and body and body.strip() and len(body) <= 4000:
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
    return select_references(library, question_text, matches), embedded.usage


def select_references(library, query_text, matches):
    """Rank bounded current saved evidence; return distinct groups or no match.

    Vectors must meet a conservative cosine cutoff. Keyword fallback uses substantive
    query terms, including saved fact requirement labels for ranking only. This initial
    heuristic is versioned, not a calibrated confidence measure.
    """
    sources = saved_reference_sources(library)
    text = {key: f"{ref.title} {ref.body}" for key, ref in sources.items()}
    groups = {key: key for key in sources}
    for role in library.experiences:
        for highlight in role.highlights:
            groups[("ExperienceHighlight", highlight.id)] = ("Experience", role.id)
    for fact in library.facts:
        key = ("LibraryFact", fact.id)
        if key in text:
            text[key] = f"{fact.requirement} {text[key]}"
    meaningful_query = " ".join(term for term in re.findall(r"[a-z0-9]+", query_text.lower())
                                if term not in _QUERY_BOILERPLATE)
    ids = {str(index): key for index, key in enumerate(sources)}
    keyword_keys = [ids[index] for index in keyword_rank(meaningful_query,
                    [(index, text[key]) for index, key in ids.items()])]
    vector_keys = [(match.source_type, match.source_id) for match in matches
                   if match.distance <= MAX_VECTOR_DISTANCE and (match.source_type, match.source_id) in sources]
    ordered = list(dict.fromkeys(vector_keys + keyword_keys))
    # Keep search rank within each class, but concrete highlights/narratives precede
    # role descriptions and bare skills; a role plus its bullets consumes one card.
    priority = {"ExperienceHighlight": 0, "Project": 0, "LibraryFact": 0, "Experience": 1, "Skill": 2}
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
