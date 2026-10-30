"""Exercise owned chat hydration under the actual restricted database grants."""
import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from psycopg import errors
from psycopg.types.json import Jsonb

from chat.client import ChatClaim
from database.chat_inputs import read_chat_input
from tests import test_career_library_reader as library_tests
from tests.test_career_library_reader import _insert, _insert_user

admin_connection = library_tests.admin_connection
pytestmark = pytest.mark.db


def seed(connection):
    user = _insert_user(connection)
    connection.execute('UPDATE users SET name = %s, contact_email = %s WHERE id = %s',
                       ('Morgan Sample', 'morgan@example.test', user))
    conversation = _insert(connection, 'chat_conversations', user_id=user, summary_text='Prior career goals',
                           summary_version=1, summary_through_position=2)
    task = _insert(connection, 'ai_tasks', user_id=user, task_type='chat_reply', status='queued')
    now = datetime.now(UTC)
    attempt = uuid4()
    operation = _insert(connection, 'chat_operations', chat_conversation_id=conversation, ai_task_id=task,
        idempotency_key=str(uuid4()), message='Help Morgan Sample prepare.', status='running', attempt_id=attempt,
        claim_generation=1, expected_position=4, summary_base_version=1,
        retry_expires_at=now + timedelta(hours=1), lease_expires_at=now + timedelta(minutes=1),
        execution_deadline=now + timedelta(minutes=2))
    for position, role, text in [(1, 'user', 'Covered old input'), (2, 'assistant', 'Covered old reply'),
                                  (3, 'user', 'Accepted career fact'), (4, 'assistant', 'Accepted advice')]:
        _insert(connection, 'chat_messages', chat_conversation_id=conversation, position=position,
                role=role, content=text, screened_sha256=hashlib.sha256(text.encode()).hexdigest() if role == 'user' else None)
    return ChatClaim(operation_id=str(operation), attempt_id=str(attempt), claim_generation=1,
        lease_expires_at=now + timedelta(minutes=1), execution_deadline=(now + timedelta(minutes=2)).replace(microsecond=now.microsecond // 1000 * 1000),
        payload={'version': 1, 'conversation_id': str(conversation), 'user_id': str(user),
                 'expected_position': 4, 'summary_base_version': 1, 'summary_through_position': 2,
                 'max_input_characters': 10000, 'summarize_every_user_messages': 20})


def read_as_reader(connection, claim):
    with connection.transaction():
        connection.execute('SET LOCAL ROLE ai_reader')
        result = read_chat_input(connection, claim)
        connection.execute('RESET ROLE')
        return result


def test_reads_only_uncovered_owned_accepted_dialogue_and_privacy_contact(admin_connection):
    current = seed(admin_connection)
    other = seed(admin_connection)
    admin_connection.execute('UPDATE chat_operations SET accepted_result = %s WHERE id = %s',
                            (Jsonb({'private': 'never read'}), current.operation_id))
    hydrated = read_as_reader(admin_connection, current)
    assert hydrated.payload.message == 'Help Morgan Sample prepare.'
    assert [m.position for m in hydrated.payload.messages] == [3, 4]
    assert hydrated.payload.summary.text == 'Prior career goals'
    assert hydrated.payload.contact.names == ['Morgan Sample']
    assert hydrated.payload.user_id != other.payload.user_id
    assert 'never read' not in hydrated.model_dump_json()


@pytest.mark.parametrize('changed', ['owner', 'conversation', 'attempt', 'generation', 'status', 'lease',
                                    'deadline', 'summary_version', 'summary_position', 'position', 'plan', 'approval'])
def test_refuses_stale_or_foreign_context(admin_connection, changed):
    current = seed(admin_connection)
    if changed in {'owner', 'conversation'}:
        field = 'user_id' if changed == 'owner' else 'conversation_id'
        current = current.model_copy(update={'payload': current.payload.model_copy(update={field: str(uuid4())})})
    elif changed in {'attempt', 'generation'}:
        current = current.model_copy(update={'attempt_id': str(uuid4())} if changed == 'attempt' else {'claim_generation': 2})
    elif changed in {'status', 'lease', 'deadline', 'plan'}:
        values = {'status': "status = 'failed'", 'lease': "lease_expires_at = now() - interval '1 second'",
                  'deadline': "execution_deadline = now() - interval '1 second'",
                  'plan': "summary_plan = '{\"through_position\": 2, \"scheduled\": false}'::jsonb"}
        admin_connection.execute(f'UPDATE chat_operations SET {values[changed]} WHERE id = %s', (current.operation_id,))
    elif changed in {'summary_version', 'summary_position'}:
        field = 'summary_version' if changed == 'summary_version' else 'summary_through_position'
        admin_connection.execute(f'UPDATE chat_conversations SET {field} = {field} + 2 WHERE id = %s',
                                (current.payload.conversation_id,))
    elif changed == 'position':
        _insert(admin_connection, 'chat_messages', chat_conversation_id=current.payload.conversation_id,
                role='user', content='Concurrent content', position=5)
    else:
        admin_connection.execute("UPDATE chat_messages SET content = 'Tampered source' WHERE chat_conversation_id = %s AND position = 3",
                                (current.payload.conversation_id,))
    with pytest.raises(ValueError, match='stale|owned|approved'):
        read_as_reader(admin_connection, current)


def test_reader_grants_deny_private_results_feedback_and_writes(admin_connection):
    seed(admin_connection)
    for query in ['SELECT accepted_result FROM chat_operations', 'SELECT result_fingerprint FROM chat_operations',
                  'SELECT title FROM chat_conversations', 'SELECT thumbs_up FROM chat_messages',
                  "UPDATE chat_messages SET content = 'changed'"]:
        with pytest.raises(errors.InsufficientPrivilege), admin_connection.transaction():
            admin_connection.execute('SET LOCAL ROLE ai_reader')
            admin_connection.execute(query)


def test_configured_http_adapter_hydrates_real_database_before_offline_models(admin_connection, monkeypatch):
    """Use the production lifespan, configured DB credentials and production reader builder."""
    import asyncio
    import os
    from unittest.mock import AsyncMock

    import psycopg
    from fastapi.testclient import TestClient
    from psycopg.rows import dict_row

    from app import create_app
    from tests.test_chat_execution import Models, Owner, Sink

    # Separate committed synthetic rows are visible to the runtime's actual ai_reader connection.
    with psycopg.connect(host=os.environ.get('DB_HOST', 'localhost'), dbname=os.environ['DB_NAME'],
                         user='postgres', password='postgres', row_factory=dict_row, autocommit=True) as source:
        current = seed(source)
        try:
            for name, value in {'AI_HTTP_ENABLED': 'true', 'AI_STREAMING_ENABLED': 'false',
                                'INTERVIEW_SERVICE_SECRET': 'synthetic-secret', 'OPENAI_API_KEY': 'offline-test-placeholder',
                                'TYPESAFE_API_KEY': 'offline-test-placeholder', 'DB_USERNAME': 'ai_reader',
                                'DB_PASSWORD': 'ai_reader'}.items():
                monkeypatch.setenv(name, value)
            monkeypatch.setattr('pii._detect_spans', lambda _: [])
            observed = []

            async def stream(messages, info):
                observed.extend(messages)
                yield 'Practice your example.'

            application = create_app()
            with TestClient(application) as http:
                assert http.get('/ready').json() == {'ready': True}
                adapter = application.state.execution_runner.adapters['chat']
                owner, sink = Owner(), Sink()
                adapter.client, adapter.models = owner, Models(stream)
                adapter._screen = AsyncMock()
                asyncio.run(adapter.execute(current, sink))
                assert owner.failed == []
                assert owner.accepted[0]['reply'] == 'Practice your example.'
                assert set(owner.accepted[0]) == {'reply', 'screened_message_sha256'}
                rendered = repr(observed)
                assert 'Prior career goals' in rendered and 'Accepted career fact' in rendered
                assert 'Covered old input' not in rendered
                assert 'Morgan Sample' not in rendered and 'morgan@example.test' not in rendered
                assert 'Help' in rendered and 'prepare.' in rendered
                assert sink.events[-1][0] == 'completed'
                # A changed durable fence must stop before screening and providers, even on replay.
                source.execute("UPDATE chat_operations SET status = 'failed' WHERE id = %s", (current.operation_id,))
                adapter._screen.reset_mock()
                owner.starts.clear()
                asyncio.run(adapter.execute(current, Sink()))
                adapter._screen.assert_not_awaited()
                assert owner.starts == []
                assert owner.failed == [('execution_failed', False)]
        finally:
            for table in ('chat_messages', 'chat_operations', 'chat_conversations'):
                column = 'id' if table == 'chat_conversations' else 'chat_conversation_id'
                source.execute(f'DELETE FROM {table} WHERE {column} = %s', (current.payload.conversation_id,))
            source.execute('DELETE FROM ai_tasks WHERE user_id = %s', (current.payload.user_id,))
            source.execute('DELETE FROM users WHERE id = %s', (current.payload.user_id,))
