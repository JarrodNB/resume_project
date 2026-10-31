"""Summary execution resolves referenced evidence before any paid work."""
from dataclasses import replace
from uuid import uuid4

from pydantic_ai.models.test import TestModel

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def test_summary_uses_owned_database_evidence(task_dependencies):
    from agents.summary_generation_agent import summary_generation_agent
    from schemas.summary_generation import SummaryGenerationInput
    owner = uuid4()
    command = {"command_version": 1, "target_kind": "profile", "target_id": str(owner),
               "source_digest": "a" * 64, "source_references": []}
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=owner, task_type="generate_summary", input=command)
    seen = []
    def read(user_id, request):
        seen.append((user_id, request.target_id))
        return SummaryGenerationInput(target_kind="profile", target_id=str(owner), source_digest="a" * 64,
            sources=[{"label": "EXPERIENCES_1_DESCRIPTION", "text": "Built billing APIs.", "screened": True}])
    dependencies = replace(task_dependencies, read_summary_sources=read)
    with summary_generation_agent.override(model=TestModel(custom_output_args={
            "text": "Engineer who built billing APIs.", "source_labels": ["EXPERIENCES_1_DESCRIPTION"]})):
        result = handle_ai_task(task, dependencies)
    assert result.status == "completed"
    assert seen == [(owner, str(owner))]
    assert "sources" not in task.input


def test_old_copied_source_commands_fail_without_paid_replay(task_dependencies, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("paid work or source read occurred")
    monkeypatch.setattr("worker.summary_generation_handler.generate_summary", forbidden)
    monkeypatch.setattr("screening.records.screen_user_text", forbidden)
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_summary",
        input={"target_kind": "profile", "target_id": str(uuid4()), "source_digest": "a" * 64,
               "sources": [{"label": "SKILLS_1_NAME", "text": "Legacy text"}]})
    assert "Start a new request" in handle_ai_task(task, task_dependencies).error_message


def test_missing_or_changed_sources_fail_before_paid_work(task_dependencies, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("paid work occurred")
    monkeypatch.setattr("worker.summary_generation_handler.generate_summary", forbidden)
    monkeypatch.setattr("screening.records.screen_user_text", forbidden)
    dependencies = replace(task_dependencies, read_summary_sources=lambda *args: None)
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_summary",
        input={"command_version": 1, "target_kind": "profile", "target_id": str(uuid4()),
               "source_digest": "a" * 64, "source_references": []})
    assert "changed" in handle_ai_task(task, dependencies).error_message
