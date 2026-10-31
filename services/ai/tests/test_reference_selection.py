"""Interview references reject weak matches and keep distinct saved examples."""
from uuid import uuid4

import pytest

from schemas.gap_analysis_context import (
    CareerContext,
    CareerLibrary,
    LibraryExperience,
    LibraryHighlight,
    LibrarySkill,
)
from schemas.library_search_match import LibrarySearchMatch


def test_unrelated_index_match_is_not_a_reference():
    from interviews.references import select_references
    context = CareerContext(id=str(uuid4()), requirement='Finance', response='Managed financial forecasts.')
    match = LibrarySearchMatch(source_type='CareerContext', source_id=context.id, content=context.response, distance=.8, score=.03)
    assert select_references(CareerLibrary(career_contexts=[context]), 'Describe your Kubernetes deployments', [match]) == []


def test_missing_vectors_cannot_qualify_through_keywords():
    from interviews.references import select_references
    context = CareerContext(id=str(uuid4()), requirement='Kubernetes', response='Maintained a production cluster.')
    refs = select_references(CareerLibrary(career_contexts=[context]), 'Describe your Kubernetes experience', [])
    assert refs == []


def test_strong_skill_match_is_not_a_reference():
    from interviews.references import select_references
    skill = LibrarySkill(id=str(uuid4()), name='Kubernetes', category='Infrastructure')
    match = LibrarySearchMatch(source_type='Skill', source_id=skill.id,
        content='Infrastructure: Kubernetes', distance=0, score=.03)
    assert select_references(CareerLibrary(skills=[skill]), 'Kubernetes', [match]) == []


def test_roles_and_highlights_share_one_slot_while_skill_matches_are_excluded():
    from interviews.references import select_references
    role = LibraryExperience(id=str(uuid4()), title='Engineer', company='Example', description='Maintained Kubernetes',
        highlights=[LibraryHighlight(id=str(uuid4()), content='Led Kubernetes migration'),
                    LibraryHighlight(id=str(uuid4()), content='Reduced Kubernetes deployment time')])
    skill = LibrarySkill(id=str(uuid4()), name='Kubernetes')
    library = CareerLibrary(experiences=[role], skills=[skill])
    from interviews.references import reference_index_texts
    index_text = reference_index_texts(library)
    matches = [LibrarySearchMatch(source_type=kind, source_id=identity, content=index_text[(kind, identity)], distance=.1, score=.03)
               for kind, identity in [('Experience',role.id), ('ExperienceHighlight',role.highlights[0].id),
                                      ('ExperienceHighlight',role.highlights[1].id)]]
    matches.insert(0, LibrarySearchMatch(source_type='Skill', source_id=skill.id,
        content='Kubernetes', distance=0, score=.05))
    refs = select_references(library, 'Kubernetes', matches)
    assert [r.source_type for r in refs] == ['ExperienceHighlight']
    assert refs[0].body == role.highlights[0].content


def test_boilerplate_question_words_do_not_create_keyword_matches():
    from interviews.references import select_references
    library = CareerLibrary(career_contexts=[CareerContext(id=str(uuid4()), requirement='Experience', response='My work was in finance')])
    assert select_references(library, 'Tell me about your experience with Kubernetes', []) == []


def test_duplicate_saved_text_is_shown_once():
    from interviews.references import select_references
    library = CareerLibrary(career_contexts=[CareerContext(id=str(uuid4()), requirement='Kubernetes', response='Maintained clusters') for _ in range(2)])
    assert len(select_references(library, 'Kubernetes', current_matches(library))) == 1


def test_all_question_formats_can_retrieve_qualifying_indexed_facts():
    import json
    from pathlib import Path

    from interviews.references import select_references
    cases = json.loads((Path(__file__).parent / 'fixtures/interview_references/questions.json').read_text())
    for case in cases:
        context = CareerContext(id=str(uuid4()), requirement=case['requirement'], response=case['response'])
        library = CareerLibrary(career_contexts=[context])
        references = select_references(library, case['question'], current_matches(library))
        assert [r.body for r in references] == [case['response']], case['format']


def test_matching_context_after_large_role_corpus_is_still_available():
    from interviews.references import select_references
    roles = [LibraryExperience(id=str(uuid4()), title='Coordinator', company='Example',
        highlights=[LibraryHighlight(id=str(uuid4()), content='Scheduled weekly meetings') for _ in range(40)])
        for _ in range(13)]
    context = CareerContext(id=str(uuid4()), requirement='Kubernetes', response='Maintained a production cluster.')
    library = CareerLibrary(experiences=roles, career_contexts=[context])
    matches = current_matches(CareerLibrary(career_contexts=[context]))
    refs = select_references(library, 'Kubernetes', matches)
    assert [ref.body for ref in refs] == [context.response]


def test_old_kubernetes_vector_cannot_select_current_finance_context():
    from interviews.references import select_references
    context = CareerContext(id=str(uuid4()), requirement='Finance', response='Managed financial forecasts.')
    old = LibrarySearchMatch(source_type='CareerContext', source_id=context.id,
        content='Fact: Kubernetes: Maintained Kubernetes clusters.', distance=.1, score=.03)
    library = CareerLibrary(career_contexts=[context])
    assert select_references(library, 'Describe Kubernetes deployments', [old]) == []
    # Even matching current words cannot revive a stale vector.
    assert select_references(library, 'Financial forecasts', [old]) == []


def test_matching_current_index_can_supply_a_semantic_only_reference():
    from interviews.references import select_references
    context = CareerContext(id=str(uuid4()), requirement='Operations', response='Reduced deployment delays.')
    current = LibrarySearchMatch(source_type='CareerContext', source_id=context.id,
        content='Fact: Operations: Reduced deployment delays.', distance=.1, score=.03)
    refs = select_references(CareerLibrary(career_contexts=[context]), 'Release throughput', [current])
    assert [ref.body for ref in refs] == [context.response]


def test_fresh_rails_index_prose_matches_every_supported_source_without_changing_bodies():
    from datetime import date

    from interviews.references import select_references
    from schemas.gap_analysis_context import LibraryCertification, LibraryEducation, LibraryProject

    role = LibraryExperience(id=str(uuid4()), title='Engineer', company='Example', location='London',
        description='  Maintained\nreliable releases.  ', highlights=[
            LibraryHighlight(id=str(uuid4()), content='Improved rollout checks.')])
    project = LibraryProject(id=str(uuid4()), name='Release tooling', role='Maintainer', description='Built release checks.')
    education = LibraryEducation(id=str(uuid4()), institution='Example University', degree='BSc',
        field_of_study='Computing', description='Studied reliability.')
    certification = LibraryCertification(id=str(uuid4()), name='Operations', issuer='Example Institute',
        issued_date=date(2024, 1, 1), issued_date_precision='year', expiry_date=date(2027, 5, 1),
        expiry_date_precision='month', credential_id='ABC', credential_url='https://example.test/ABC',
        description='Deployment qualification.')
    context = CareerContext(id=str(uuid4()), requirement='Operations', response='Reduced deployment delays.')
    library = CareerLibrary(experiences=[role], projects=[project], educations=[education],
        certifications=[certification], career_contexts=[context])
    cases = [
        ('Experience', role.id, 'Engineer at Example (London): Maintained reliable releases.', role.description),
        ('ExperienceHighlight', role.highlights[0].id, 'Engineer at Example: Improved rollout checks.', role.highlights[0].content),
        ('Project', project.id, 'Project: Release tooling (Maintainer): Built release checks.', project.description),
        ('Education', education.id, 'BSc in Computing, Example University: Studied reliability.', education.description),
        ('Certification', certification.id, 'Certification: Operations, Issuer: Example Institute, Issued date: 2024, Expiry date: 2027-05, Credential id: ABC, Credential url: https://example.test/ABC: Deployment qualification.', certification.description),
        ('CareerContext', context.id, 'Fact: Operations: Reduced deployment delays.', context.response),
    ]
    for kind, source_id, index_text, body in cases:
        current = LibrarySearchMatch(source_type=kind, source_id=source_id, content=index_text, distance=.1, score=.03)
        refs = select_references(library, 'Shipping velocity', [current])
        assert [ref.body for ref in refs] == [body], kind


def test_keyword_overlap_cannot_bypass_similarity_threshold():
    from interviews.references import select_references
    context = CareerContext(id=str(uuid4()), requirement='Kubernetes', response='Maintained Kubernetes clusters.')
    match = LibrarySearchMatch(source_type='CareerContext', source_id=context.id,
        content='Fact: Kubernetes: Maintained Kubernetes clusters.', distance=.8, score=.03)
    assert select_references(CareerLibrary(career_contexts=[context]), 'Kubernetes', [match]) == []


def current_matches(library, distance=.1):
    """Supply current indexed prose at the external embedding-search seam."""
    from interviews.references import reference_index_texts
    return [LibrarySearchMatch(source_type=kind, source_id=identity, content=text,
                               distance=distance, score=.03)
            for (kind, identity), text in reference_index_texts(library).items()]


@pytest.mark.parametrize(('distance', 'qualifies'), [(.349999, True), (.35, True), (.350001, False)])
def test_default_threshold_includes_boundary_only(distance, qualifies):
    from interviews.references import select_references
    context = CareerContext(id=str(uuid4()), requirement='Kubernetes', response='Maintained clusters.')
    library = CareerLibrary(career_contexts=[context])
    refs = select_references(library, 'Kubernetes', current_matches(library, distance))
    assert bool(refs) is qualifies


@pytest.mark.parametrize(('similarity', 'qualifies'), [(.7, True), (.8, True), (.9, False)])
def test_configured_similarity_changes_selection(similarity, qualifies):
    from interviews.references import select_references
    context = CareerContext(id=str(uuid4()), requirement='Operations', response='Reduced delays.')
    library = CareerLibrary(career_contexts=[context])
    assert bool(select_references(library, 'Throughput', current_matches(library, .2),
                                 min_similarity=similarity)) is qualifies


def test_at_most_three_distinct_sources_are_returned():
    from interviews.references import select_references
    library = CareerLibrary(career_contexts=[CareerContext(id=str(uuid4()), requirement='Operations',
        response=f'Reduced deployment delay for team {index}.') for index in range(5)])
    refs = select_references(library, 'Throughput', current_matches(library))
    assert [str(ref.source_id) for ref in refs] == [context.id for context in library.career_contexts[:3]]
