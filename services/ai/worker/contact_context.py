"""Load the queue task's owned profile before entering shared contact masking.

The reusable privacy module accepts an explicit profile. This queue adapter also
merges the retained tailoring snapshot and selects import privacy for resume tasks.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from database.open_read_only_connection import open_read_only_connection
from database.profile_contact import read_profile_contact
from privacy.contact_mask import contact_scope, has_contact_scope, import_privacy_scope
from privacy.known_contact import KnownContact
from settings import load_settings
from worker.queue_messages import AiTaskMessage


@contextmanager
def using_known_contact(task: AiTaskMessage) -> Iterator[None]:
    """Loads the user's name, contact email, and phone and applies them for one task."""
    if has_contact_scope():
        yield
        return
    contact = _load_known_contact(task)
    if task.task_type == "parse_resume":
        with import_privacy_scope(contact):
            yield
        return
    with contact_scope(contact):
        yield


def _load_known_contact(task: AiTaskMessage) -> KnownContact:
    """Profile columns plus the tailoring snapshot, when the task carries one."""
    with open_read_only_connection(load_settings()) as connection:
        name, email, phone = read_profile_contact(connection, task.user_id)
    snapshot = task.input.get("contact")
    if not isinstance(snapshot, dict):
        snapshot = {}
    return KnownContact.from_values(
        names=[name, snapshot.get("full_name")],
        emails=[email, snapshot.get("email")],
        phones=[phone, snapshot.get("phone")],
    )
