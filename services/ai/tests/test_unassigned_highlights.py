"""Keep ambiguous synthetic source bullets intact through privacy restoration."""
from pii import prepare_document
from schemas.parsed_resume import ParsedResume


def test_unassigned_highlights_default_empty():
    assert ParsedResume().unassigned_highlights == []


def test_restore_unassigned_text_and_context():
    _, session = prepare_document('Jane Doe\njane@example.test\nHelped Jane Doe ship.')
    parsed = ParsedResume.model_validate({'unassigned_highlights': [{'source_id': 'b7', 'text': session.mask('Helped Jane Doe ship.'), 'source_context': session.mask('Jane Doe roles')} ]})
    restored = session.restore(parsed)
    assert restored.unassigned_highlights[0].model_dump() == {'source_id': 'b7', 'text': 'Helped Jane Doe ship.', 'source_context': 'Jane Doe roles', 'reason': 'ambiguous_role'}
