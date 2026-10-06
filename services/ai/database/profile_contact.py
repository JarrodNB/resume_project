"""
Description: Reads the profile fields the worker is allowed to know so outbound text can
be masked. The sign-in email and password stay unreadable.
Index:
    - read_profile_contact: name, contact_email, and phone for one user
"""

from uuid import UUID

import psycopg
from psycopg.rows import DictRow

PROFILE_CONTACT_QUERY = """
    SELECT name, contact_email, phone FROM users WHERE id = %(user_id)s
"""


def read_profile_contact(
    connection: psycopg.Connection[DictRow], user_id: UUID
) -> tuple[str | None, str | None, str | None]:
    """The user's name, contact email, and phone, or Nones when the user is gone."""
    row = connection.execute(PROFILE_CONTACT_QUERY, {"user_id": user_id}).fetchone()
    if row is None:
        return (None, None, None)
    return (row["name"], row["contact_email"], row["phone"])
