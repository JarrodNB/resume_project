"""Exercise shipped real/fixture DB credentials with offline providers in an isolated DB."""

import asyncio
import os
from pathlib import Path

import psycopg
import pytest
import yaml
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from database.interview_inputs import interview_database_ready
from interviews.client import FAKE_CONFIGURATION
from interviews.executor import InterviewExecutor
from interviews.real import RealInterviewExecutor
from settings import AISettings
from tests.test_career_library_reader import _insert
from tests.test_interview_executor import Client
from tests.test_interview_input_reader import seed
from tests.test_interview_preparation import PreparationClient
from tests.test_job_interview_context import JobModels

pytestmark = [pytest.mark.db, pytest.mark.real_guardrail]


class ComposeLoader(yaml.SafeLoader):
    pass


ComposeLoader.add_constructor(
    "!override", lambda loader, node: loader.construct_mapping(node, deep=True)
)


@pytest.mark.parametrize(
    "filename",
    [
        "docker-compose.yml",
        "docs/interview-recovery.compose.yml",
        "docs/interview-real-qa.compose.yml",
    ],
)
def test_shipped_runtime_configuration_hydrates_owned_operations(monkeypatch, filename):
    repo = Path(os.environ.get("TEST_REPOSITORY_ROOT", "/repo"))
    if not (repo / filename).exists():
        pytest.skip("Mount repository at TEST_REPOSITORY_ROOT to check shipped Compose settings")
    database = os.environ.get("DB_NAME", "")
    assert database.endswith("_test"), (
        "Configured runtime hydration must use an isolated test database"
    )
    env = yaml.load((repo / filename).read_text(), Loader=ComposeLoader)["services"]["ai-http"][
        "environment"
    ]
    with psycopg.connect(
        host=os.environ["DB_HOST"],
        dbname=database,
        user="postgres",
        password="postgres",
        row_factory=dict_row,
        autocommit=True,
    ) as admin:
        claim, _ = seed(admin, saved_job=True)
        owner, session = claim.payload.user_id, claim.payload.interview_id
        try:
            for name in ["DB_HOST", "DB_USERNAME", "DB_PASSWORD"]:
                monkeypatch.setenv(name, env[name])
            monkeypatch.setenv("DB_NAME", database)
            assert interview_database_ready(AISettings())
            if filename.endswith("interview-recovery.compose.yml"):
                question = _insert(
                    admin,
                    "interview_session_questions",
                    interview_session_id=session,
                    position=0,
                    content="Saved fixture question?",
                )
                _insert(
                    admin,
                    "interview_session_messages",
                    interview_session_id=session,
                    question_id=question,
                    position=0,
                    kind="opening",
                    content="Saved fixture question?",
                    semantic_key="fixture-opening",
                )
                admin.execute(
                    "UPDATE interview_sessions SET status='active', execution_mode='fake', execution_config=%s, fixture_context=%s WHERE id=%s",
                    (Jsonb(FAKE_CONFIGURATION.model_dump()), Jsonb({"synthetic": True}), session),
                )
                admin.execute(
                    "UPDATE interview_session_operations SET kind='turn', question_id=%s, expected_revision=0, submission_key='fixture', request_fingerprint='fingerprint', transcription_mode='typed', candidate_transcript='Reviewed fixture answer' WHERE id=%s",
                    (question, claim.operation_id),
                )
                claim = claim.model_copy(
                    update={
                        "kind": "turn",
                        "execution_mode": "fake",
                        "execution_config": FAKE_CONFIGURATION,
                    }
                )
                client = Client()
                executor = InterviewExecutor(client, storage_client=None, allowed_origins=set())
            else:
                client = PreparationClient()
                executor = RealInterviewExecutor(
                    client,
                    audio=None,
                    models=JobModels(count=8),
                    storage_client=None,
                    allowed_origins=set(),
                )
            # No input_reader injection: production wiring resolves the configured ai_reader credentials.
            asyncio.run(executor.execute(claim))
            assert not client.failed, client.failed
            assert client.accepted
        finally:
            for table in [
                "interview_session_operations",
                "interview_session_messages",
                "interview_session_questions",
            ]:
                admin.execute(f"DELETE FROM {table} WHERE interview_session_id=%s", (session,))
            admin.execute("DELETE FROM interview_sessions WHERE id=%s", (session,))
            admin.execute("DELETE FROM jobs WHERE user_id=%s", (owner,))
            admin.execute("DELETE FROM users WHERE id=%s", (owner,))


def test_recovery_reader_setup_handles_fresh_and_retained_roles():
    from uuid import uuid4

    repo = Path(os.environ.get("TEST_REPOSITORY_ROOT", "/repo"))
    script = repo / "infra/postgres/ensure_interview_reader.sql"
    if not script.exists():
        pytest.skip("Mount repository to check recovery role provisioning")
    database = os.environ.get("DB_NAME", "")
    assert database.endswith("_test")
    role = f"interview_reader_test_{uuid4().hex}"
    with psycopg.connect(
        host=os.environ["DB_HOST"],
        dbname=database,
        user="postgres",
        password="postgres",
        row_factory=dict_row,
    ) as admin, admin.transaction(force_rollback=True):
        # Run the shipped SQL on a unique uncommitted role; shared roles stay untouched.
        sql = script.read_text().replace("ai_reader", role)
        admin.execute(sql)
        admin.execute(sql)
        result = admin.execute(
            "SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=%s",
            (role,),
        ).fetchone()
        assert result == {
            "rolcanlogin": True,
            "rolsuper": False,
            "rolcreatedb": False,
            "rolcreaterole": False,
        }
