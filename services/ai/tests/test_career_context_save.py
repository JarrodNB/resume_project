"""Check save status and subsequent library/reference reads with real owner grants."""
import pytest

from database.career_context_save import check_career_context_save
from database.career_library_reader import read_career_library
from interviews.references import saved_reference_sources
from tests.test_career_library_reader import _insert, _insert_user, admin_connection  # noqa: F401

pytestmark = pytest.mark.db


def test_preflight_is_owned_and_saved_response_is_available_for_interviews(admin_connection):  # noqa: F811
    connection = admin_connection
    user, other = _insert_user(connection), _insert_user(connection)
    _insert(connection, 'career_contexts', user_id=other, requirement='Incident', response='Foreign fact')
    assert check_career_context_save(connection, user, 'Incident', 'I coordinated recovery.') == 'ready'
    identity = _insert(connection, 'career_contexts', user_id=user, requirement='Incident', response='I coordinated recovery.')
    connection.execute('SET LOCAL ROLE ai_reader')
    assert check_career_context_save(connection, user, 'Incident', 'I coordinated recovery.') == 'already_saved'
    assert check_career_context_save(connection, user, 'Incident', 'Other fact') == 'conflict'
    library = read_career_library(connection, user)
    assert [context.response for context in library.career_contexts] == ['I coordinated recovery.']
    assert saved_reference_sources(library)[('CareerContext', str(identity))].body == 'I coordinated recovery.'
