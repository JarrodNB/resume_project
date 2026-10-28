"""
Description: Opens a read-only Postgres connection as the ai_reader role. The role can only
SELECT (granted by Rails), and the session is read-only too, so a write fails twice over.
Index:
    - open_read_only_connection: a new connection whose rows come back as dicts
"""

import psycopg
from psycopg.rows import DictRow, dict_row

from settings import AISettings


def open_read_only_connection(settings: AISettings) -> psycopg.Connection[DictRow]:
    """Connects with the settings' ai_reader credentials; every transaction is read-only."""
    return psycopg.connect(
        host=settings.db_host,
        port=settings.db_port,
        dbname=settings.db_name,
        user=settings.db_username,
        password=settings.db_password,
        connect_timeout=settings.db_connect_timeout_seconds,
        options="-c default_transaction_read_only=on",
        row_factory=dict_row,
    )
