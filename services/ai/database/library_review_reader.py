"""Read only an owner's selected review section and compute execution-local targets.

The command stores identities and context digests, never source text. Comparing these
fresh targets before generation prevents queued work from silently reviewing edited data.
"""

import hashlib
import json
from datetime import date
from uuid import UUID

from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus

from database.career_library_reader import (
    CAREER_CONTEXTS_QUERY,
    EXPERIENCES_QUERY,
    HIGHLIGHTS_QUERY,
    PROJECTS_QUERY,
    SUMMARY_QUERY,
    _bounded_rows,
)
from database.open_read_only_connection import open_read_only_connection
from schemas.library_review import LibraryReviewInput


def _digest(value):
    """Match ReviewSources's compact ActiveSupport JSON, including HTML escaping."""
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                      default=lambda item: item.isoformat() if isinstance(item, date) else str(item))
    for character in ("<", ">", "&"):
        text = text.replace(character, f"\\u{ord(character):04x}")
    return hashlib.sha256(text.encode()).hexdigest()


def _fields(row, names):
    return {name: row[name] for name in names.split()}


def read_library_review(connection, user_id: UUID, section: str, *, record_id=None, experience_id=None) -> LibraryReviewInput:
    """Select only this section, including owner-scoped children, in one transaction."""
    if section not in ("experience", "summary", "projects", "career_contexts"):
        raise ValueError("Choose a supported library section")
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    params = {"user_id": user_id, "record_id": record_id, "experience_id": experience_id}

    def selected(query, predicate, value):
        if value is None:
            return query
        head, order = query.split("ORDER BY", 1)
        return head + " AND " + predicate + " ORDER BY" + order
    targets = []

    def target(kind, record, field, digest):
        targets.append({"kind": kind, "record_id": record["id"], "field": field,
                        "source_digest": digest, "label": f"T{len(targets) + 1}"})

    with connection.transaction(), connection.cursor() as cursor:
        if section == "summary":
            row = cursor.execute(SUMMARY_QUERY, params).fetchone()
            if row is None:
                raise ValueError("Career library owner is unavailable")
            library = {"summary_record_id": row["id"], "summary": row["summary"],
                       "screened_fields": row["screened_fields"]}
            if row["summary"] and row["summary"].strip():
                target("user", row, "summary", _digest(_fields(row, "id summary")))
        elif section == "experience":
            roles = _bounded_rows(cursor, selected(EXPERIENCES_QUERY, "id = %(experience_id)s", experience_id), params)
            highlights = _bounded_rows(cursor, selected(HIGHLIGHTS_QUERY, "experiences.id = %(experience_id)s", experience_id), params)
            library = {"experiences": []}
            for row in roles:
                role = _fields(row, "id company title location start_date end_date description screened_fields")
                role["highlights"] = [_fields(item, "id content screened_fields") for item in highlights
                                      if item["experience_id"] == role["id"]]
                content = {key: value for key, value in role.items() if key != "screened_fields"}
                content["highlights"] = [{key: value for key, value in item.items() if key != "screened_fields"}
                                         for item in role["highlights"]]
                digest = _digest(content)
                if role["description"] and role["description"].strip():
                    target("experience", role, "description", digest)
                for item in role["highlights"]:
                    target("experience_highlight", item, "content", digest)
                library["experiences"].append(role)
        else:
            query, keys, kind, field = (
                (PROJECTS_QUERY, "id name role start_date end_date description screened_fields", "project", "description")
                if section == "projects" else
                (CAREER_CONTEXTS_QUERY, "id requirement response screened_fields", "career_context", "response")
            )
            records = [_fields(row, keys) for row in _bounded_rows(cursor, selected(query, "id = %(record_id)s", record_id), params)]
            library = {section: records}
            for row in records:
                if section == "career_contexts" or row[field] and row[field].strip():
                    target(kind, row, field, _digest({key: value for key, value in row.items() if key != "screened_fields"}))
    return LibraryReviewInput(section=section, library=library, targets=targets)


def build_database_review_reader(settings):
    """Open a fresh restricted connection for each queued review."""
    def read(user_id, section):
        with open_read_only_connection(settings) as connection:
            return read_library_review(connection, user_id, section)
    return read
