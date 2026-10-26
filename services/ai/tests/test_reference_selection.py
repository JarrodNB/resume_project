"""Interview references reject weak matches and keep distinct saved examples."""
from uuid import uuid4

from schemas.gap_analysis_context import (
    CareerLibrary,
    LibraryExperience,
    LibraryFact,
    LibraryHighlight,
    LibrarySkill,
)
from schemas.library_search_match import LibrarySearchMatch


def test_unrelated_index_match_is_not_a_reference():
    from interviews.references import select_references
    fact = LibraryFact(id=str(uuid4()), requirement='Finance', response='Managed financial forecasts.')
    match = LibrarySearchMatch(source_type='LibraryFact', source_id=fact.id, content=fact.response, distance=.8, score=.03)
    assert select_references(CareerLibrary(facts=[fact]), 'Describe your Kubernetes deployments', [match]) == []


def test_missing_vectors_use_saved_fact_requirement_for_keyword_ranking_only():
    from interviews.references import select_references
    fact = LibraryFact(id=str(uuid4()), requirement='Kubernetes', response='Maintained a production cluster.')
    refs = select_references(CareerLibrary(facts=[fact]), 'Describe your Kubernetes experience', [])
    assert len(refs) == 1 and refs[0].body == fact.response
    assert 'Kubernetes' not in refs[0].body


def test_roles_and_highlights_share_one_slot_and_narratives_precede_skills():
    from interviews.references import select_references
    role = LibraryExperience(id=str(uuid4()), title='Engineer', company='Example', description='Maintained Kubernetes',
        highlights=[LibraryHighlight(id=str(uuid4()), content='Led Kubernetes migration'),
                    LibraryHighlight(id=str(uuid4()), content='Reduced Kubernetes deployment time')])
    skill = LibrarySkill(id=str(uuid4()), name='Kubernetes')
    library = CareerLibrary(experiences=[role], skills=[skill])
    matches = [LibrarySearchMatch(source_type=kind, source_id=identity, content='Kubernetes', distance=.1, score=.03)
               for kind, identity in [('Skill',skill.id), ('Experience',role.id), ('ExperienceHighlight',role.highlights[0].id),
                                      ('ExperienceHighlight',role.highlights[1].id)]]
    refs = select_references(library, 'Kubernetes', matches)
    assert [r.source_type for r in refs] == ['ExperienceHighlight', 'Skill']
    assert refs[0].body == role.highlights[0].content


def test_boilerplate_question_words_do_not_create_keyword_matches():
    from interviews.references import select_references
    library = CareerLibrary(facts=[LibraryFact(id=str(uuid4()), requirement='Experience', response='My work was in finance')])
    assert select_references(library, 'Tell me about your experience with Kubernetes', []) == []


def test_duplicate_saved_text_is_shown_once():
    from interviews.references import select_references
    library = CareerLibrary(facts=[LibraryFact(id=str(uuid4()), requirement='Kubernetes', response='Maintained clusters') for _ in range(2)])
    assert len(select_references(library, 'Kubernetes', [])) == 1


def test_all_question_formats_can_retrieve_unindexed_saved_facts():
    import json
    from pathlib import Path

    from interviews.references import select_references
    cases = json.loads((Path(__file__).parent / 'fixtures/interview_references/questions.json').read_text())
    for case in cases:
        fact = LibraryFact(id=str(uuid4()), requirement=case['requirement'], response=case['response'])
        references = select_references(CareerLibrary(facts=[fact]), case['question'], [])
        assert [r.body for r in references] == [case['response']], case['format']
