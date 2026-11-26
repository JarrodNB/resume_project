"""Check the Python source reader against the cases shared with Rails' PracticeTaskFence.

Both suites load tests/fixtures/practice_task_fence_cases.json. Each case saves a task command
beside a few rows and says whether the task is still current. Rails answers at apply time and
Python at read time, so a few cases differ on purpose; the fixture's 'note' explains each one.
Uses the real restricted role; all synthetic writes roll back.
"""
import json
from pathlib import Path

import pytest
from psycopg.types.json import Jsonb

from tests import test_career_library_reader as fixtures
from tests.test_career_library_reader import _insert, _insert_user
from worker.queue_messages import AiTaskMessage

pytestmark = pytest.mark.db

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "practice_task_fence_cases.json").read_text())
SUBJECT_TYPES = {"generate_interview_questions": "InterviewQuestionSet"}


@pytest.fixture
def admin_connection():
    yield from fixtures.admin_connection.__wrapped__()


def resolve(value, ids):
    """Swap '@set' / '@qN' placeholders (in keys and values) for saved ids."""
    if isinstance(value, dict):
        return {resolve(key, ids): resolve(inner, ids) for key, inner in value.items()}
    return ids.get(value, value) if isinstance(value, str) else value


def save_rows(connection, owner, case):
    """Insert the base rows with the case's overrides; return the set id and question ids by key."""
    set_row = {**FIXTURE["base_state"]["set"], **case.get("set", {})}
    set_id = _insert(connection, "interview_question_sets", user_id=owner, number=set_row["number"],
                     set_type=set_row["set_type"], origin=set_row["origin"])
    question_ids = {}
    if case.get("no_questions"):
        return set_id, question_ids
    overrides = case.get("questions", {})
    for index, (key, row) in enumerate(FIXTURE["base_state"]["questions"].items()):
        if key in overrides and overrides[key] is None:
            continue
        row = {**row, **(overrides.get(key) or {})}
        retired = row.pop("retired", False)
        if "answer_drafts" in row:
            row["answer_drafts"] = Jsonb(row["answer_drafts"])
        question_ids[key] = _insert(
            connection, "interview_questions", interview_question_set_id=set_id,
            question_text=f"Question {key}?", position=None if retired else index + 1,
            retired_at=None if not retired else "2026-01-01T00:00:00Z", **row)
    return set_id, question_ids


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_reader_agrees_with_shared_case(admin_connection, case):
    from database.interview_questions import read_interview_question_sources
    owner = _insert_user(admin_connection)
    set_id, question_ids = save_rows(admin_connection, owner, case)
    ids = {"@set": str(set_id), **{f"@{key}": str(value) for key, value in question_ids.items()}}
    task_type = case["task_type"]
    command = resolve(FIXTURE["base_commands"][task_type], ids)
    for key, value in case.get("command_changes", {}).items():
        if value is None:
            command.pop(key, None)
        else:
            command[key] = value
    if "subject" in case:
        subject_id = question_ids[case["subject"]]
    else:
        subject_id = set_id if task_type == "generate_interview_questions" else question_ids["q1"]
    task_owner = _insert_user(admin_connection) if case.get("task_owner") == "other_user" else owner
    task_id = _insert(admin_connection, "ai_tasks", user_id=task_owner, subject_id=subject_id,
                      subject_type=SUBJECT_TYPES.get(task_type, "InterviewQuestion"),
                      task_type=task_type, status=case.get("task_status", "queued"), input=Jsonb(command))
    message = AiTaskMessage(ai_task_id=task_id, user_id=task_owner, task_type=task_type, input=command)

    admin_connection.execute("SET LOCAL ROLE ai_reader")
    sources = read_interview_question_sources(admin_connection, message)

    assert (sources is not None) == (case["expect"]["python"] == "current"), case.get("note")


def test_case_names_are_unique_and_cover_every_task_type():
    names = [case["name"] for case in FIXTURE["cases"]]
    assert len(names) == len(set(names))
    assert {case["task_type"] for case in FIXTURE["cases"]} == set(FIXTURE["base_commands"])
