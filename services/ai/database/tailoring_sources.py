"""Read the owned records needed for one resume draft in one consistent transaction.

The comparison view exposes only completed gap-analysis output. Foreign or deleted
references fail closed; source values and their screening receipts travel together.
"""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus

from database.career_library_reader import read_gap_analysis_context
from database.open_read_only_connection import open_read_only_connection
from schemas.gap_analysis_context import GapAnalysisContext
from schemas.gap_response import GapResponseSnapshot


@dataclass
class TailoringSources:
    context: GapAnalysisContext
    contact: dict[str, Any]
    gap_analysis: dict[str, Any] | None
    gap_responses: list[GapResponseSnapshot]


def read_tailoring_sources(connection, task_id: UUID, user_id: UUID, job_id: UUID,
                           analysis_task_id: UUID | None) -> TailoringSources | None:
    """Read nothing for a foreign job or mismatched completed comparison."""
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    params = {"task_id": task_id, "user_id": user_id, "job_id": job_id, "analysis_task_id": analysis_task_id}
    with connection.transaction():
        command = connection.execute("""
            SELECT task.id FROM queued_tailoring_commands task
            JOIN jobs ON jobs.id = task.job_id AND jobs.user_id = task.user_id
            WHERE task.id = %(task_id)s AND task.user_id = %(user_id)s
              AND jobs.id = %(job_id)s
        """, params).fetchone()
        if command is None:
            return None
        context = read_gap_analysis_context(connection, user_id, job_id)
        if context is None:
            return None
        contact = connection.execute("""
            SELECT name AS full_name, contact_email AS email, phone, location, links
            FROM users WHERE id = %(user_id)s
        """, params).fetchone()
        analysis = None
        if analysis_task_id is not None:
            row = connection.execute("""
                SELECT comparison.gap_analysis FROM completed_gap_analysis_sources comparison
                JOIN jobs ON jobs.id = comparison.job_id AND jobs.user_id = comparison.user_id
                WHERE comparison.id = %(analysis_task_id)s
                  AND comparison.user_id = %(user_id)s AND jobs.id = %(job_id)s
            """, params).fetchone()
            if row is None:
                return None
            analysis = row["gap_analysis"]
        rows = connection.execute("""
            SELECT response.id::text, response.requirement, response.body, response.screened_fields
            FROM job_gap_responses response JOIN jobs ON jobs.id = response.job_id
            WHERE jobs.user_id = %(user_id)s AND jobs.id = %(job_id)s
            ORDER BY response.created_at, response.id
        """, params).fetchall()
        return TailoringSources(context, dict(contact), analysis,
                                [GapResponseSnapshot(**row) for row in rows])


def build_tailoring_sources_reader(settings):
    """Open a fresh read-only connection for each queued execution."""
    def read(task_id, user_id, job_id, analysis_task_id):
        with open_read_only_connection(settings) as connection:
            return read_tailoring_sources(connection, task_id, user_id, job_id, analysis_task_id)
    return read
