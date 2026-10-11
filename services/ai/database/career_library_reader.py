"""
Description: Reads one saved job and the user's career library for gap analysis. Every query is
scoped by the task's user id, so a job id from another user reads nothing. All reads share one
REPEATABLE READ transaction, so they see the same moment even if the user edits meanwhile.
Ordering matches the Rails API (dated entries most recent first, highlights and skills by
position).
Index:
    - read_career_library / build_database_library_reader: job-independent library snapshot
    - read_gap_analysis_context: the job and library, or None when the user has no such job
    - build_database_context_reader: a reader that opens a fresh connection per call
"""

from collections.abc import Callable
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
from worker.settings import WorkerSettings

# Same order as the MostRecentFirst concern in Rails.
MOST_RECENT_FIRST = """
    (end_date IS NULL AND start_date IS NOT NULL) DESC,
    end_date DESC NULLS LAST,
    start_date DESC NULLS LAST,
    position
"""

JOB_QUERY = """
    SELECT id::text, title, company, requirements, responsibilities, nice_to_haves
    FROM jobs WHERE id = %(job_id)s AND user_id = %(user_id)s
"""
SUMMARY_QUERY = "SELECT summary FROM users WHERE id = %(user_id)s"
EXPERIENCES_QUERY = f"""
    SELECT id::text, company, title, location, start_date, end_date, description
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
    SELECT id::text, name, role, description, start_date, end_date
    FROM projects WHERE user_id = %(user_id)s ORDER BY {MOST_RECENT_FIRST}
"""
EDUCATIONS_QUERY = f"""
    SELECT id::text, institution, degree, field_of_study, description, start_date, end_date
    FROM educations WHERE user_id = %(user_id)s ORDER BY {MOST_RECENT_FIRST}
"""
CERTIFICATIONS_QUERY = """
    SELECT id::text, name, issuer, issued_date, issued_date_precision, expiry_date, expiry_date_precision, credential_id, credential_url, description
    FROM certifications WHERE user_id = %(user_id)s
    ORDER BY issued_date DESC NULLS LAST, position
"""
SKILLS_QUERY = """
    SELECT id::text, name, category FROM skills WHERE user_id = %(user_id)s
    ORDER BY position, name
"""
FACTS_QUERY = """
    SELECT id::text, requirement, response FROM library_facts WHERE user_id = %(user_id)s
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
    return GapAnalysisContext(job=JobToAnalyze(**job_row), career_library=library)


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
            LibraryExperience(**row, highlights=highlights_by_experience.get(row["id"], []))
            for row in experience_rows
        ],
        projects=[LibraryProject(**row) for row in project_rows],
        educations=[LibraryEducation(**row) for row in education_rows],
        certifications=[LibraryCertification(**row) for row in certification_rows],
        skills=[LibrarySkill(**row) for row in skill_rows],
        facts=[LibraryFact(**row) for row in fact_rows],
    )
    return library


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
