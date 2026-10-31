"""Resolve an owned queued preference check against current confirmed sources.

The repeatable read binds command, revision, selected catalogue rows and saved
screening receipts. Retained legacy prose is checked for equality, never reused.
"""
from uuid import UUID

from pydantic import ValidationError

from database.open_read_only_connection import open_read_only_connection
from database.task_commands import read_task_command
from job_postings.preference_listing import fingerprint, listing_source
from schemas.job_preferences import PreferenceCheckInput


def read_preference_input(connection, notification):
    if notification.task_type != "check_job_preferences":
        return None
    task = read_task_command(connection, notification)
    if task is None:
        return None
    command = task.input
    criteria, listings = command.get("criteria"), command.get("listings")
    if not isinstance(criteria, list) or not 1 <= len(criteria) <= 10 or not isinstance(listings, list) or not 1 <= len(listings) <= 100:
        return None
    if not all(isinstance(item, dict) for item in criteria + listings):
        return None
    try:
        profile_id = UUID(command.get("profile_id"))
    except (TypeError, ValueError, AttributeError):
        return None
    profile = connection.execute("""SELECT id, confirmed_revision, confirmed_criteria, screened_criteria_sha256
        FROM job_preference_profiles WHERE id = %s AND user_id = %s""",
        [profile_id, task.user_id]).fetchone()
    if profile is None or profile["confirmed_revision"] != command.get("confirmed_revision") or len(profile["confirmed_criteria"]) != len(criteria):
        return None
    generated = connection.execute("""SELECT text FROM ai_generated_preference_criteria
        WHERE user_id = %s AND text = ANY(%s::text[])""",
        [task.user_id, [item["text"] for item in profile["confirmed_criteria"]]]).fetchall()
    generated_text = {row["text"] for row in generated}
    loaded_criteria = []
    for reference, current in zip(criteria, profile["confirmed_criteria"], strict=True):
        digest = fingerprint(current["text"])
        if (reference.get("id") != current["id"] or reference.get("priority") != current["priority"]
                or (reference.get("text_sha256") or fingerprint(reference.get("text"))) != digest):
            return None
        loaded_criteria.append({**current, "screened": digest in profile["screened_criteria_sha256"],
                                "trusted_generated": current["text"] in generated_text})
    ids = [item.get("id") for item in listings]
    try:
        if len(set(ids)) != len(ids):
            return None
        ids = [UUID(item) for item in ids]
    except (TypeError, ValueError, AttributeError):
        return None
    rows = connection.execute("SELECT id, payload, screened_sha256 FROM job_board_listings WHERE id = ANY(%s::uuid[])", [ids]).fetchall()
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(ids):
        return None
    loaded_listings = []
    for reference, listing_id in zip(listings, ids, strict=True):
        row = by_id[listing_id]
        current = listing_source(str(listing_id), row["payload"], len(ids))
        digest = fingerprint([part["text"] for part in current["passages"]])
        expected = reference.get("passages_sha256")
        if expected is None and isinstance(reference.get("passages"), list):
            expected = fingerprint([part.get("text") for part in reference["passages"] if isinstance(part, dict)])
        if reference.get("source_digest") != current["source_digest"] or reference.get("truncated") != current["truncated"] or expected != digest:
            return None
        loaded_listings.append({**current, "screened": row["screened_sha256"] == digest})
    try:
        return PreferenceCheckInput(profile_id=profile["id"], confirmed_revision=profile["confirmed_revision"], criteria=loaded_criteria, listings=loaded_listings)
    except ValidationError:
        return None


def build_preference_reader(settings):
    def read(task):
        with open_read_only_connection(settings) as connection, connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            return read_preference_input(connection, task)
    return read
