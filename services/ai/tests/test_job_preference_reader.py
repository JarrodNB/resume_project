"""Preference sources come from owned current database rows, never saved task copies."""
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.job_preferences import read_preference_input
from job_postings.preference_listing import fingerprint, listing_source
from tests import test_career_library_reader as fixtures
from tests.test_career_library_reader import _insert, _insert_user
from worker.queue_messages import AiTaskMessage


def test_rejects_foreign_or_finished_work_before_reading_preferences():
    class Missing:
        def execute(self, sql, values):
            assert "status = 'queued'" in sql
            return SimpleNamespace(fetchone=lambda: None)
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="check_job_preferences", input={})
    assert read_preference_input(Missing(), task) is None


@pytest.fixture
def admin_connection():
    yield from fixtures.admin_connection.__wrapped__()


def seed(connection, legacy=False):
    owner = _insert_user(connection)
    criterion = {"id": str(uuid4()), "text": "遠隔 & remote <work>\u2028", "priority": "must_have"}
    _insert(connection, "ai_tasks", user_id=owner, task_type="elicit_job_preferences", status="completed", result=Jsonb({"criteria": [criterion]}))
    profile = _insert(connection, "job_preference_profiles", user_id=owner, version=2, confirmed_revision=2,
                      confirmed_criteria=Jsonb([criterion]), screened_criteria_sha256=[fingerprint(criterion["text"])])
    payload = {"title": "開発者", "description": "<p>資料 &amp; API</p><ul><li>Build</li></ul>" + "資料" * 4000}
    listing = _insert(connection, "job_board_listings", provider_id=uuid4().int % 10**15, payload=Jsonb(payload))
    source = listing_source(str(listing), payload, 1)
    passage_fingerprint = fingerprint([part["text"] for part in source["passages"]])
    connection.execute("UPDATE job_board_listings SET screened_sha256 = %s WHERE id = %s", [passage_fingerprint, listing])
    reference = {"id": criterion["id"], "priority": criterion["priority"], "text_sha256": fingerprint(criterion["text"]), "trusted_generated": True}
    listing_ref = {key: source[key] for key in ("id", "source_digest", "truncated")}
    listing_ref["passages_sha256"] = passage_fingerprint
    if legacy:
        reference = {**criterion, "trusted_generated": True, "screened": False}
        listing_ref = {**source, "screened": False}
    command = {"profile_id": str(profile), "confirmed_revision": 2, "criteria": [reference], "listings": [listing_ref]}
    task_id = _insert(connection, "ai_tasks", user_id=owner, task_type="check_job_preferences", status="queued", input=Jsonb(command))
    return AiTaskMessage(ai_task_id=task_id, user_id=owner, task_type="check_job_preferences", input={"criteria": "POISON"}), profile, listing, command


@pytest.mark.db
@pytest.mark.parametrize("legacy", [False, True])
def test_reads_current_owned_sources_and_receipts_as_restricted_role(admin_connection, legacy):
    task, _, _, _ = seed(admin_connection, legacy)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    result = read_preference_input(admin_connection, task)
    assert result.criteria[0].text == "遠隔 & remote <work>\u2028"
    assert result.criteria[0].screened and result.criteria[0].trusted_generated
    assert result.listings[0].screened and result.listings[0].truncated
    assert result.listings[0].passages[0].text == "Job: 開発者"


@pytest.mark.db
@pytest.mark.parametrize("change", ["owner", "type", "completed", "revision", "text", "priority", "listing", "deleted_listing", "foreign_profile", "forged_passages", "forged_criterion"])
def test_rejects_changed_or_foreign_sources_before_paid_work(admin_connection, change):
    task, profile, listing, command = seed(admin_connection, legacy=change.startswith("forged"))
    if change in ("owner", "type"):
        task = task.model_copy(update={"user_id": uuid4()} if change == "owner" else {"task_type": "generate_summary"})
    elif change == "completed":
        admin_connection.execute("UPDATE ai_tasks SET status='completed' WHERE id=%s", [task.ai_task_id])
    elif change == "revision":
        admin_connection.execute("UPDATE job_preference_profiles SET version=3, confirmed_revision=3 WHERE id=%s", [profile])
    elif change in ("text", "priority"):
        criterion = {"id": command["criteria"][0]["id"], "text": "Changed" if change == "text" else "遠隔 & remote <work>\u2028", "priority": "nice_to_have" if change == "priority" else "must_have"}
        admin_connection.execute("UPDATE job_preference_profiles SET confirmed_criteria=%s WHERE id=%s", [Jsonb([criterion]), profile])
    elif change == "foreign_profile":
        admin_connection.execute("UPDATE job_preference_profiles SET user_id=%s WHERE id=%s", [_insert_user(admin_connection), profile])
    elif change == "listing":
        admin_connection.execute("UPDATE job_board_listings SET payload='{}' WHERE id=%s", [listing])
    elif change == "deleted_listing":
        admin_connection.execute("DELETE FROM job_board_listings WHERE id=%s", [listing])
    else:
        if change == "forged_passages":
            command["listings"][0]["passages"][0]["text"] = "POISON"
        else:
            command["criteria"][0]["text"] = "POISON"
        admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", [Jsonb(command), task.ai_task_id])
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_preference_input(admin_connection, task) is None


@pytest.mark.parametrize("case", json.loads((Path(__file__).parent / "fixtures/preference_sources.json").read_text()))
def test_rails_python_source_and_receipt_parity(case):
    actual = listing_source(case["expected"]["id"], case["payload"], case["count"])
    assert actual == case["expected"]
    assert fingerprint(case["criterion_text"]) == case["criterion_fingerprint"]
    assert fingerprint([part["text"] for part in actual["passages"]]) == case["fingerprint"]


def test_handler_cannot_run_saved_prose_without_an_authoritative_reader(task_dependencies):
    from tests.test_job_preference_check import snapshot
    from worker.job_preference_handler import handle_job_preference_check_task
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="check_job_preferences", input=snapshot())
    assert handle_job_preference_check_task(task, task_dependencies).status == "failed"


@pytest.mark.db
@pytest.mark.parametrize("provenance", ["foreign", "unfinished", "wrong_type", "changed", "matching"])
def test_generated_criterion_provenance_is_owned_completed_and_exact(admin_connection, provenance):
    task, _, _, command = seed(admin_connection, legacy=True)
    admin_connection.execute("DELETE FROM ai_tasks WHERE task_type='elicit_job_preferences'")
    criterion = command["criteria"][0]
    source = {**criterion, "text": "Changed"} if provenance == "changed" else criterion
    owner = _insert_user(admin_connection) if provenance == "foreign" else task.user_id
    _insert(admin_connection, "ai_tasks", user_id=owner,
            task_type="generate_summary" if provenance == "wrong_type" else "elicit_job_preferences",
            status="queued" if provenance == "unfinished" else "completed", result=Jsonb({"criteria": [source]}))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    result = read_preference_input(admin_connection, task)
    assert result.criteria[0].trusted_generated is (provenance == "matching")


@pytest.mark.db
def test_rails_spaced_heading_command_reaches_model_with_exact_current_passages(admin_connection, task_dependencies):
    from dataclasses import replace

    from agents.job_preference_agent import job_preference_agent
    from tests.test_job_preference_check import model
    from worker.job_preference_handler import handle_job_preference_check_task

    task, _, listing_id, command = seed(admin_connection)
    cases = json.loads((Path(__file__).parent / "fixtures/preference_sources.json").read_text())
    case = next(item for item in cases if item["payload"].get("description", "").startswith("<p>Skills :"))
    admin_connection.execute("UPDATE job_board_listings SET payload=%s WHERE id=%s", [Jsonb(case["payload"]), listing_id])
    reference = {key: case["expected"][key] for key in ("source_digest", "truncated")}
    command["listings"] = [{**reference, "id": str(listing_id), "passages_sha256": case["fingerprint"]}]
    admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", [Jsonb(command), task.ai_task_id])
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    dependencies = replace(task_dependencies, read_preference_input=lambda notification: read_preference_input(admin_connection, notification))
    with job_preference_agent.override(model=model()):
        result = handle_job_preference_check_task(task, dependencies)
    assert result.status == "completed"
    assert result.result["listings"][0]["source_digest"] == case["expected"]["source_digest"]
