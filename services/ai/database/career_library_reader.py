"""
Description: Reads one saved job and the user's career library for gap analysis. Every query is
scoped by the task's user id, so a job id from another user reads nothing. All reads share one
REPEATABLE READ transaction, so they see the same moment even if the user edits meanwhile.
Ordering matches the Rails API (dated entries most recent first, highlights and skills by
position). Private record state is attached to the exact complete source and never
serialized into prompts.
Index:
    - read_career_library / build_database_library_reader: job-independent library snapshot
    - read_gap_analysis_context: the job and library, or None when the user has no such job
    - build_database_context_reader: a reader that opens a fresh connection per call
"""

from collections.abc import Callable
from datetime import UTC
from uuid import UUID

import psycopg
from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus
from psycopg.rows import DictRow

from database.open_read_only_connection import open_read_only_connection
from schemas.gap_analysis_context import (
    CareerLibrary,
    GapAnalysisContext,
    JobToAnalyze,
    LibraryCertification,
    LibraryEducation,
    LibraryExperience,
    LibraryFact,
    LibraryHighlight,
    LibraryProject,
    LibrarySkill,
)
from schemas.record_screening import RecordScreeningState
from worker.settings import WorkerSettings

# Same order as the MostRecentFirst concern in Rails.
MOST_RECENT_FIRST = """
    (end_date IS NULL AND start_date IS NOT NULL) DESC,
    end_date DESC NULLS LAST,
    start_date DESC NULLS LAST,
    position
"""

JOB_QUERY = """
    SELECT id::text, updated_at, screened_at, screening_policy_version, title, company, requirements, responsibilities, nice_to_haves
    FROM jobs WHERE id = %(job_id)s AND user_id = %(user_id)s
"""
SUMMARY_QUERY = "SELECT id::text, summary, updated_at, screened_at, screening_policy_version FROM users WHERE id = %(user_id)s"
EXPERIENCES_QUERY = f"""
    SELECT id::text, updated_at, screened_at, screening_policy_version, company, title, location, start_date, end_date, description
    FROM experiences WHERE user_id = %(user_id)s ORDER BY {MOST_RECENT_FIRST}
"""
HIGHLIGHTS_QUERY = """
    SELECT highlights.id::text, highlights.experience_id::text, highlights.content
    FROM experience_highlights AS highlights
    JOIN experiences ON experiences.id = highlights.experience_id
    WHERE experiences.user_id = %(user_id)s
    ORDER BY highlights.position
"""
PROJECTS_QUERY = f"""
    SELECT id::text, updated_at, screened_at, screening_policy_version, name, role, description, start_date, end_date
    FROM projects WHERE user_id = %(user_id)s ORDER BY {MOST_RECENT_FIRST}
"""
EDUCATIONS_QUERY = f"""
    SELECT id::text, updated_at, screened_at, screening_policy_version, institution, degree, field_of_study, description, start_date, end_date
    FROM educations WHERE user_id = %(user_id)s ORDER BY {MOST_RECENT_FIRST}
"""
CERTIFICATIONS_QUERY = """
    SELECT id::text, updated_at, screened_at, screening_policy_version, name, issuer, issued_date, issued_date_precision, expiry_date, expiry_date_precision, credential_id, credential_url, description
    FROM certifications WHERE user_id = %(user_id)s
    ORDER BY issued_date DESC NULLS LAST, position
"""
SKILLS_QUERY = """
    SELECT id::text, updated_at, screened_at, screening_policy_version, name, category FROM skills WHERE user_id = %(user_id)s
    ORDER BY position, name
"""
FACTS_QUERY = """
    SELECT id::text, updated_at, screened_at, screening_policy_version, requirement, response FROM library_facts WHERE user_id = %(user_id)s
    ORDER BY created_at
"""


def read_gap_analysis_context(
    connection: psycopg.Connection[DictRow], user_id: UUID, job_id: UUID
) -> GapAnalysisContext | None:
    """Reads the user's job and career library in one consistent snapshot."""
    params = {"user_id": user_id, "job_id": job_id}
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction(), connection.cursor() as cursor:
        job_row = cursor.execute(JOB_QUERY, params).fetchone()
        if job_row is None:
            return None
        library = _read_library(cursor, params)
    return GapAnalysisContext(job=_saved_record(JobToAnalyze, job_row, "Job"), career_library=library)


def _read_library(cursor, params: dict) -> CareerLibrary:
    """Reads library rows within the caller's snapshot transaction."""
    summary_row = cursor.execute(SUMMARY_QUERY, params).fetchone()
    experience_rows = cursor.execute(EXPERIENCES_QUERY, params).fetchall()
    highlight_rows = cursor.execute(HIGHLIGHTS_QUERY, params).fetchall()
    project_rows = cursor.execute(PROJECTS_QUERY, params).fetchall()
    education_rows = cursor.execute(EDUCATIONS_QUERY, params).fetchall()
    certification_rows = cursor.execute(CERTIFICATIONS_QUERY, params).fetchall()
    skill_rows = cursor.execute(SKILLS_QUERY, params).fetchall()
    fact_rows = cursor.execute(FACTS_QUERY, params).fetchall()
    highlights_by_experience: dict[str, list[LibraryHighlight]] = {}
    for row in highlight_rows:
        highlights_by_experience.setdefault(row["experience_id"], []).append(
            LibraryHighlight(id=row["id"], content=row["content"])
        )

    library = CareerLibrary(
        summary=summary_row["summary"] if summary_row else None,
        experiences=[
            _saved_record(LibraryExperience, {**row, "highlights": highlights_by_experience.get(row["id"], [])}, "Experience")
            for row in experience_rows
        ],
        projects=[_saved_record(LibraryProject, row, "Project") for row in project_rows],
        educations=[_saved_record(LibraryEducation, row, "Education") for row in education_rows],
        certifications=[_saved_record(LibraryCertification, row, "Certification") for row in certification_rows],
        skills=[_saved_record(LibrarySkill, row, "Skill") for row in skill_rows],
        facts=[_saved_record(LibraryFact, row, "LibraryFact") for row in fact_rows],
    )
    if summary_row:
        library._summary_screening_state = _state(summary_row, "User", library.summary or "")
    return library


def _state(row, record_type, source):
    # Rails stores UTC timestamps without a PostgreSQL time zone. Make the queue's
    # observed-version timestamp explicit so a worker host's timezone cannot alter it.
    updated_at = row["updated_at"]
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=UTC)
    return RecordScreeningState(
        record_type=record_type, record_id=row["id"], observed_updated_at=updated_at,
        screened_at=row["screened_at"], screening_policy_version=row["screening_policy_version"],
        source=source,
    )


def _saved_record(model, row, record_type):
    record = model(**row)
    record._screening_state = _state(row, record_type, record.model_dump_json(exclude_none=True))
    return record


def build_database_context_reader(
    settings: WorkerSettings,
) -> Callable[[UUID, UUID], GapAnalysisContext | None]:
    """A reader for TaskDependencies that connects per task, so a database restart between tasks
    needs no reconnect logic."""

    def read_from_database(user_id: UUID, job_id: UUID) -> GapAnalysisContext | None:
        """Opens a connection, reads the context, and closes the connection."""
        with open_read_only_connection(settings) as connection:
            return read_gap_analysis_context(connection, user_id, job_id)

    return read_from_database


def read_career_library(connection: psycopg.Connection[DictRow], user_id: UUID) -> CareerLibrary:
    """Reads a user-scoped library without requiring a saved job."""
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction(), connection.cursor() as cursor:
        return _read_library(cursor, {"user_id": user_id})


def build_database_library_reader(settings: WorkerSettings) -> Callable[[UUID], CareerLibrary]:
    """Builds a job-independent reader opening one read-only connection per task."""
    def read_from_database(user_id: UUID) -> CareerLibrary:
        """Reads the current library and closes the connection."""
        with open_read_only_connection(settings) as connection:
            return read_career_library(connection, user_id)
    return read_from_database
