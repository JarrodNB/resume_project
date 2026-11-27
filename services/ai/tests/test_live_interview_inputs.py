"""Read a live interview's instruction inputs as ai_reader, scoped to its open connection."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.live_interview_inputs import read_live_interview_inputs
from interviews.client import REAL_CONFIGURATION
from tests import test_career_library_reader as library_reader_tests
from tests.test_career_library_reader import _insert

admin_connection = library_reader_tests.admin_connection

pytestmark = pytest.mark.db

ROLE = {"title": "Laboratory technician", "responsibilities": ["Maintain instruments"], "requirements": []}


def seed(connection, *, saved_job=False, job_deleted=False, connection_status="connected", session_status="active"):
    owner = _insert(connection, "users", email=f"{uuid4()}@example.com", name="Jordan Rivera",
                    contact_email="jordan@example.com", phone="555-123-4567")
    job = _insert(connection, "jobs", user_id=owner, title="Senior lab analyst", company="Acme Labs",
                  description="Run assays.", requirements=Jsonb(["GLP"]), responsibilities=Jsonb([]),
                  nice_to_haves=Jsonb([])) if saved_job and not job_deleted else None
    session = _insert(
        connection, "interview_sessions", user_id=owner, status=session_status, execution_mode="real",
        execution_config=Jsonb(REAL_CONFIGURATION.model_dump()), conversation_mode="live",
        preparation_kind="saved_job" if saved_job else "fictional_role", job_id=job,
        prepared_role=Jsonb({} if saved_job else ROLE),
        setup_config=Jsonb({"question_count": 5, "interviewer": "maya", "difficulty": "warm_up"}),
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    for position, content in [(1, "Second question?"), (0, "First question?")]:
        _insert(connection, "interview_session_questions", interview_session_id=session, position=position,
                content=content, question_type="behavioral")
    live = _insert(connection, "interview_live_connections", interview_session_id=session,
                   room_name=f"interview-{session}-room", status=connection_status)
    return {"interview_id": str(session), "user_id": str(owner), "connection_id": str(live)}


def read_as_reader(connection, ids):
    with connection.transaction():
        connection.execute("SET LOCAL ROLE ai_reader")
        result = read_live_interview_inputs(connection, **ids)
        connection.execute("RESET ROLE")
        return result


def test_reads_setup_role_ordered_questions_and_contact_for_masking(admin_connection):
    inputs = read_as_reader(admin_connection, seed(admin_connection))
    assert inputs.setup.interviewer == "maya" and inputs.setup.difficulty == "warm_up"
    assert inputs.questions == ("First question?", "Second question?")
    assert inputs.role == ROLE and inputs.job is None
    assert inputs.contact.mask("Jordan Rivera at jordan@example.com, 555-123-4567") == "«name» at «email», «phone»"


def test_reads_the_current_saved_job_for_a_job_interview(admin_connection):
    inputs = read_as_reader(admin_connection, seed(admin_connection, saved_job=True))
    assert inputs.role is None
    assert inputs.job["title"] == "Senior lab analyst" and inputs.job["requirements"] == ["GLP"]


def test_a_deleted_saved_job_is_read_as_unavailable_so_a_running_interview_carries_on(admin_connection):
    inputs = read_as_reader(admin_connection, seed(admin_connection, saved_job=True, job_deleted=True))
    assert inputs.job is None and inputs.role is None and inputs.job_deleted
    assert inputs.questions == ("First question?", "Second question?")


@pytest.mark.parametrize("wrong", ["owner", "connection", "unclaimed", "ended", "finished"])
def test_refuses_another_owner_or_a_connection_that_is_not_live(admin_connection, wrong):
    status = {"unclaimed": "authorized", "ended": "ended"}.get(wrong, "connected")
    ids = seed(admin_connection, connection_status=status,
               session_status="completed" if wrong == "finished" else "active")
    if wrong == "owner":
        ids["user_id"] = str(uuid4())
    if wrong == "connection":
        ids["connection_id"] = str(uuid4())
    with pytest.raises(ValueError, match="not available"):
        read_as_reader(admin_connection, ids)
