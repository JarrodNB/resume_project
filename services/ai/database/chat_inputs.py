"""Load accepted chat context for one live, owned operation.

Rails chooses compaction checkpoints under its lock. This reader verifies those
fences and reconstructs only uncovered dialogue in one coherent read transaction.
"""
import hashlib

from psycopg import Error, IsolationLevel
from psycopg.pq import TransactionStatus

from chat.client import ChatPayload
from database.open_read_only_connection import open_read_only_connection
from database.profile_contact import read_profile_contact

OPERATION_QUERY = """
SELECT o.message, o.expected_position, o.summary_base_version, o.summary_plan,
       c.summary_text, c.summary_version, c.summary_through_position,
       (SELECT COALESCE(MAX(m.position), 0) FROM chat_messages m
        WHERE m.chat_conversation_id = c.id) AS last_position
FROM chat_operations o JOIN chat_conversations c ON c.id = o.chat_conversation_id
WHERE o.id = %(operation_id)s AND c.id = %(conversation_id)s AND c.user_id = %(user_id)s
 AND o.attempt_id = %(attempt_id)s AND o.claim_generation = %(generation)s
 AND o.status = 'running' AND o.lease_expires_at > clock_timestamp()
 AND o.execution_deadline > clock_timestamp()
 -- Rails timestamps use millisecond JSON precision; Postgres retains microseconds.
 AND date_trunc('milliseconds', o.execution_deadline) = date_trunc('milliseconds', %(deadline)s::timestamptz)
"""


def read_chat_input(connection, claim):
    """Reject foreign, expired or changed claims before any source reaches a model."""
    command = claim.payload
    params = {"operation_id": claim.operation_id, "conversation_id": command.conversation_id,
              "user_id": command.user_id, "attempt_id": claim.attempt_id,
              "generation": claim.claim_generation, "deadline": claim.execution_deadline}
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout = '5s'")
        row = cursor.execute(OPERATION_QUERY, params).fetchone()
        plan = command.summary_plan.model_dump() if command.summary_plan else {}
        if (row is None or row['expected_position'] != command.expected_position
                or row['last_position'] != command.expected_position
                or row['summary_version'] != command.summary_base_version
                or row['summary_base_version'] != command.summary_base_version
                or row['summary_through_position'] != command.summary_through_position
                or row['summary_plan'] != plan):
            raise ValueError("Chat claim is stale or not owned")
        messages = cursor.execute("""
            SELECT m.role, m.content, m.position, m.screened_sha256 FROM chat_messages m
            JOIN chat_conversations c ON c.id = m.chat_conversation_id
            WHERE c.id = %(conversation_id)s AND c.user_id = %(user_id)s
              AND m.position > %(through)s ORDER BY m.position LIMIT 1001
            """, {**params, "through": command.summary_through_position}).fetchall()
        if len(messages) != command.expected_position - command.summary_through_position or any(
                m['role'] == 'user' and m['screened_sha256'] != hashlib.sha256(m['content'].encode()).hexdigest()
                for m in messages):
            raise ValueError("Chat history is not approved or complete")
        name, email, phone = read_profile_contact(connection, command.user_id)
        payload = ChatPayload(conversation_id=command.conversation_id, user_id=command.user_id,
            message=row['message'], max_input_characters=command.max_input_characters,
            summarize_every_user_messages=command.summarize_every_user_messages,
            messages=[{k: m[k] for k in ('role', 'content', 'position')} for m in messages],
            summary={'text': row['summary_text'], 'version': row['summary_version'],
                     'through_position': row['summary_through_position']}, summary_plan=command.summary_plan,
            contact={'names': [name] if name else [], 'emails': [email] if email else [],
                     'phones': [phone] if phone else []})
        # Source reads can take time. Check actual wall time again in the same transaction.
        if cursor.execute(OPERATION_QUERY, params).fetchone() is None:
            raise ValueError("Chat claim expired during reading")
    return claim.model_copy(update={'payload': payload})


def build_chat_input_reader(settings):
    def read(claim):
        with open_read_only_connection(settings) as connection:
            return read_chat_input(connection, claim)
    return read


def chat_database_ready(settings):
    """Verify narrow grants and connectivity without selecting any account's data."""
    if settings.db_username != 'ai_reader':
        return False
    try:
        with open_read_only_connection(settings) as connection:
            connection.execute("SET LOCAL statement_timeout = '2s'")
            connection.execute("SELECT id, user_id, summary_text, summary_version, summary_through_position FROM chat_conversations LIMIT 0")
            connection.execute("SELECT id, chat_conversation_id, message, status, attempt_id, claim_generation, lease_expires_at, execution_deadline, expected_position, summary_base_version, summary_plan FROM chat_operations LIMIT 0")
            connection.execute("SELECT chat_conversation_id, position, role, content, screened_sha256 FROM chat_messages LIMIT 0")
        return True
    except Error:
        return False
