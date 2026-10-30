"""Use actual ai_reader grants to check summary ownership, freshness and exact trust."""
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.summary_sources import _fingerprint, read_summary_sources
from schemas.summary_generation import SummaryCommand
from tests.test_career_library_reader import _insert, _insert_user
from tests.test_career_library_reader import admin_connection as _admin_connection

admin_connection = _admin_connection

pytestmark = pytest.mark.db


def command(kind, target_id, sources):
    refs = [{**{key: source[key] for key in ("label", "record_id", "section_id") if key in source},
             "fingerprint": _fingerprint(source["text"])} for source in sources]
    return SummaryCommand(command_version=1, target_kind=kind, target_id=str(target_id),
                          source_digest=_fingerprint(refs), source_references=refs)


def test_owned_profile_sources_and_stale_hashes(admin_connection):
    connection = admin_connection
    owner, foreign = _insert_user(connection), _insert_user(connection)
    role = _insert(connection, "experiences", user_id=owner, company="Acme", title="Engineer",
                   description="Built café APIs <safely> & precisely.", screened_fields=["title"])
    _insert(connection, "experiences", user_id=foreign, company="Private", title="Do not read")
    sources = [{"label": f"EXPERIENCES_1_{field}", "record_id": str(role), "text": text}
               for field, text in [("COMPANY", "Acme"), ("TITLE", "Engineer"),
                                   ("DESCRIPTION", "Built café APIs <safely> & precisely.")]]
    request = command("profile", owner, sources)
    connection.execute("SET LOCAL ROLE ai_reader")
    loaded = read_summary_sources(connection, owner, request)
    assert [source.text for source in loaded.sources] == [source["text"] for source in sources]
    assert [source.screened for source in loaded.sources] == [False, True, False]
    assert read_summary_sources(connection, foreign, request) is None
    connection.execute("RESET ROLE")
    connection.execute("UPDATE experiences SET description = 'Changed' WHERE id = %s", [role])
    connection.execute("SET LOCAL ROLE ai_reader")
    assert read_summary_sources(connection, owner, request) is None


def test_resume_trust_is_exact_owned_accepted_generated_prose(admin_connection):
    connection = admin_connection
    owner, foreign = _insert_user(connection), _insert_user(connection)
    resume = _insert(connection, "resumes", user_id=owner, title="Saved")
    items = [{"title": "Engineer", "highlights": ["Exact generated", "Edited generated", "Foreign prose", "Unaccepted prose"]}]
    section = _insert(connection, "resume_sections", resume_id=resume, section_type="experience", title="Experience",
                      content=Jsonb({"items": items}), position=0)
    education = _insert(connection, "resume_sections", resume_id=resume, section_type="education", title="Education",
                        content=Jsonb({"items": [{"description": "Copied education"}]}), position=1)
    for user, accepted, values in [(owner, True, ["Exact generated", "Generated before edit"]),
                                   (foreign, True, ["Foreign prose"]), (owner, False, ["Unaccepted prose"])]:
        _insert(connection, "ai_tasks", user_id=user, task_type="tailor_resume", status="completed",
                accepted_at="2026-10-01" if accepted else None,
                result=Jsonb({"sections": [
                    {"section_type": "experience", "content": {"items": [{"highlights": values}]}},
                    {"section_type": "education", "content": {"items": [{"description": "Copied education"}]}}
                ]}))
    sources = [{"label": "SECTION_1_ITEM_1_TITLE", "section_id": str(section), "text": "Engineer"}]
    sources += [{"label": f"SECTION_1_ITEM_1_HIGHLIGHT_{index}", "section_id": str(section), "text": text}
                for index, text in enumerate(items[0]["highlights"], 1)]
    sources += [{"label": "SECTION_2_ITEM_1_DESCRIPTION", "section_id": str(education), "text": "Copied education"}]
    request = command("resume", resume, sources)
    connection.execute("SET LOCAL ROLE ai_reader")
    loaded = read_summary_sources(connection, owner, request)
    assert [source.text for source in loaded.sources if source.screened] == ["Exact generated"]
    assert read_summary_sources(connection, foreign, request) is None
    assert read_summary_sources(connection, owner, request.model_copy(update={"target_id": str(uuid4())})) is None
    connection.execute("RESET ROLE")
    connection.execute("DELETE FROM resume_sections WHERE id = %s", [section])
    connection.execute("SET LOCAL ROLE ai_reader")
    assert read_summary_sources(connection, owner, request) is None


def test_all_profile_source_labels_match_the_command_and_context_is_not_evidence(admin_connection):
    connection = admin_connection
    owner = _insert_user(connection)
    specs = [
        ("projects", {"name": "Tool", "role": "Author", "description": "Built CLI"}),
        ("educations", {"institution": "College", "degree": "BSc", "field_of_study": "Computing", "description": "Studied systems"}),
        ("certifications", {"name": "Credential", "issuer": "Issuer", "description": "Passed exam"}),
        ("skills", {"name": "SQL", "category": "Database"}),
        ("career_contexts", {"response": "I built a queue"}),
    ]
    sources = []
    for table, fields in specs:
        values = {**fields, "requirement": "Do not use as career evidence"} if table == "career_contexts" else fields
        record = _insert(connection, table, user_id=owner, **values)
        sources.extend({"label": f"{table.upper()}_1_{field.upper()}", "record_id": str(record), "text": text}
                       for field, text in fields.items())
    request = command("profile", owner, sources)
    connection.execute("SET LOCAL ROLE ai_reader")
    evidence = read_summary_sources(connection, owner, request)
    assert [source.text for source in evidence.sources] == [source["text"] for source in sources]
    assert "Do not use as career evidence" not in evidence.model_dump_json()
