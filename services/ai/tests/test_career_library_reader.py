"""
Description: Integration tests for the career library reader against the compose Postgres. Seeds
rows as the admin role inside a transaction that always rolls back, then reads them as ai_reader
(SET LOCAL ROLE), so the real grants are exercised. Skipped when the database isn't reachable.
Run only these with `docker compose run --rm ai-worker pytest -m db`.
Index:
    - admin_connection: a postgres connection inside a rolled-back transaction
    - test_reads_the_job_and_library_in_rails_order
    - test_another_users_job_reads_nothing
    - test_reads_profile_name_email_and_phone
"""

import os
from collections.abc import Iterator
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import DictRow, dict_row
from psycopg.types.json import Jsonb

from database.career_library_reader import read_gap_analysis_context
from database.profile_contact import read_profile_contact

pytestmark = pytest.mark.db


@pytest.fixture
def admin_connection() -> Iterator[psycopg.Connection[DictRow]]:
    """Connects as the admin role (seeding needs writes); everything is rolled back."""
    try:
        connection = psycopg.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            dbname=os.environ.get("DB_NAME", "api_development"),
            user=os.environ.get("DB_ADMIN_USERNAME", "postgres"),
            password=os.environ.get("DB_ADMIN_PASSWORD", "postgres"),
            connect_timeout=3,
            row_factory=dict_row,
        )
    except psycopg.OperationalError as error:
        pytest.skip(f"Postgres isn't reachable: {error}")
    with connection, connection.transaction(force_rollback=True):
        yield connection


def _insert(connection: psycopg.Connection[DictRow], table: str, **values: object) -> UUID:
    """Inserts one row with timestamps and returns its new id."""
    row_id = uuid4()
    columns = ["id", "created_at", "updated_at", *values]
    placeholders = ["%s", "now()", "now()", *["%s"] * len(values)]
    connection.execute(
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(placeholders)})",
        [row_id, *values.values()],
    )
    return row_id


def _insert_user(connection: psycopg.Connection[DictRow], summary: str | None = None) -> UUID:
    """Inserts a user with a unique email."""
    return _insert(connection, "users", email=f"{uuid4()}@example.com", summary=summary)


def test_reads_the_job_and_library_in_rails_order(
    admin_connection: psycopg.Connection[DictRow],
) -> None:
    """Every section comes back, ongoing roles first, highlights by position, all as ai_reader."""
    user_id = _insert_user(admin_connection, summary="Backend engineer")
    job_id = _insert(
        admin_connection,
        "jobs",
        user_id=user_id,
        title="Platform Engineer",
        company="Acme",
        requirements=Jsonb(["5 years of Python"]),
        responsibilities=Jsonb(["Ship models"]),
        nice_to_haves=Jsonb(["Kubernetes"]),
        screened_fields=["title", "requirements"],
    )
    old_role = _insert(
        admin_connection,
        "experiences",
        user_id=user_id,
        company="Old Co",
        title="Developer",
        start_date="2015-01-01",
        end_date="2018-01-01",
    )
    current_role = _insert(
        admin_connection,
        "experiences",
        user_id=user_id,
        company="Now Co",
        title="Lead",
        screened_fields=["title"],
        start_date="2020-01-01",
    )
    _insert(
        admin_connection,
        "experience_highlights",
        experience_id=current_role,
        content="Second",
        position=1,
    )
    _insert(
        admin_connection,
        "experience_highlights",
        experience_id=current_role,
        content="First",
        position=0,
    )
    _insert(admin_connection, "projects", user_id=user_id, name="CLI tool")
    _insert(admin_connection, "educations", user_id=user_id, institution="State University")
    certification_id = _insert(
        admin_connection, "certifications", user_id=user_id, name="AWS Solutions Architect",
        issuer="Amazon", issued_date="2024-01-01", issued_date_precision="year",
        expiry_date="2027-03-01", expiry_date_precision="month",
        credential_id="AWS-123", credential_url="https://example.com/credential",
        description="Cloud architecture", position=0,
    )
    other_user = _insert_user(admin_connection)
    _insert(admin_connection, "certifications", user_id=other_user, name="Other credential", position=0)
    _insert(admin_connection, "skills", user_id=user_id, name="Python")
    context_id = _insert(
        admin_connection,
        "career_contexts",
        user_id=user_id,
        requirement="Kubernetes",
        response="Ran production Kubernetes at Northwind",
    )
    _insert(
        admin_connection,
        "job_gap_responses",
        job_id=job_id,
        requirement="Go",
        body="Only saved on the job",
    )
    admin_connection.execute("SET LOCAL ROLE ai_reader")

    context = read_gap_analysis_context(admin_connection, user_id, job_id)

    assert context is not None
    assert context.job.requirements == ["5 years of Python"]
    assert context.job.screened_fields == ["title", "requirements"]
    assert "screened_fields" not in context.job.model_dump_json()
    assert context.job.responsibilities == ["Ship models"]
    assert context.job.nice_to_haves == ["Kubernetes"]
    library = context.career_library
    assert library.summary == "Backend engineer"
    assert library.summary_record_id == str(user_id)
    assert library.experiences[0].screened_fields == ["title"]
    assert "screened_fields" not in library.model_dump_json()
    assert [experience.id for experience in library.experiences] == [
        str(current_role),
        str(old_role),
    ]
    assert [highlight.content for highlight in library.experiences[0].highlights] == [
        "First",
        "Second",
    ]
    assert [project.name for project in library.projects] == ["CLI tool"]
    assert [education.institution for education in library.educations] == ["State University"]
    assert len(library.certifications) == 1
    certification = library.certifications[0]
    assert certification.id == str(certification_id)
    assert certification.issued_date_precision == "year"
    assert certification.expiry_date_precision == "month"
    assert certification.credential_id == "AWS-123"
    assert certification.credential_url == "https://example.com/credential"
    assert certification.expiry_date.isoformat() == "2027-03-01"
    assert [skill.name for skill in library.skills] == ["Python"]
    assert [(context.id, context.requirement, context.response) for context in library.career_contexts] == [
        (str(context_id), "Kubernetes", "Ran production Kubernetes at Northwind")
    ]


def test_another_users_job_reads_nothing(admin_connection: psycopg.Connection[DictRow]) -> None:
    """A job id that belongs to someone else returns None, not their job."""
    owner_id = _insert_user(admin_connection)
    other_user_id = _insert_user(admin_connection)
    job_id = _insert(admin_connection, "jobs", user_id=owner_id, title="Engineer", company="Acme")
    admin_connection.execute("SET LOCAL ROLE ai_reader")

    assert read_gap_analysis_context(admin_connection, other_user_id, job_id) is None


def test_reads_profile_name_email_and_phone(admin_connection: psycopg.Connection[DictRow]) -> None:
    """ai_reader can read the contact fields used for masking."""
    user_id = _insert(
        admin_connection,
        "users",
        email=f"{uuid4()}@example.com",
        name="Ada Lovelace",
        contact_email="ada@example.com",
        phone="555-0100",
    )
    admin_connection.execute("SET LOCAL ROLE ai_reader")

    assert read_profile_contact(admin_connection, user_id) == (
        "Ada Lovelace",
        "ada@example.com",
        "555-0100",
    )


def test_job_independent_library_is_user_scoped(admin_connection: psycopg.Connection[DictRow]) -> None:
    """Interview generation reads a library without a job and excludes other owners."""
    from database.career_library_reader import read_career_library

    owner_id = _insert_user(admin_connection)
    other_user_id = _insert_user(admin_connection)
    _insert(admin_connection, "skills", user_id=owner_id, name="Python", position=0)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert [skill.name for skill in read_career_library(admin_connection, owner_id).skills] == ["Python"]
    assert read_career_library(admin_connection, other_user_id).is_empty()
