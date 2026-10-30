"""Evaluate synthetic chat through the production guarded execution adapter.

Run with `python -m evals.run_chat_evals`; this calls Jev and configured generation
providers and incurs charges. It makes no Rails writes. Its in-memory owner records
provider receipts while the production adapter handles screening, privacy and agents.
Deterministic checks measure targeted continuity and honesty signals, not broad quality.
"""
import os
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from pydantic_evals import Dataset

from chat.client import ChatClaim
from chat.execution import ChatExecutionAdapter
from chat.models import ChatModels
from evals.chat_evaluators import (
    CareerChatOutcome,
    ChatEvalExpectations,
    ChatEvalInput,
    ChatEvalOutput,
)
from evals.telemetry import evaluate_dataset
from mcp_tools.client import ToolServerConnection
from mcp_tools.local_server import serve_in_background
from mcp_tools.server import create_mcp_server
from prompts.chat_instructions import CHAT_PROMPT_VERSION
from prompts.chat_summary_instructions import CHAT_SUMMARY_PROMPT_VERSION
from settings import load_settings


def load_chat_dataset():
    return Dataset[ChatEvalInput, ChatEvalOutput, ChatEvalExpectations].from_file(
        Path(__file__).parent / "datasets/chat_cases.yaml", custom_evaluator_types=(CareerChatOutcome,))


class EvalOwner:
    """Record actual synthetic provider costs without storing product records."""
    def __init__(self):
        self.result, self.failure = None, None
        self.pending, self.receipts = set(), {}

    async def start_provider(self, claim, observation_id, stage, provider, model):
        self.pending.add(observation_id)
        return {"observation_id": observation_id}

    async def usage(self, claim, usage, *, incomplete=False, observation_id=None):
        if observation_id:
            self.receipts[observation_id] = (usage, incomplete)
        return True

    async def accept(self, claim, **values):
        self.result = values
        return {"message_ids": ["synthetic-user", "synthetic-assistant"]}

    async def fail(self, claim, code, retryable):
        self.failure = code
        return {}


async def execute_chat_case(case, *, models=None):
    owner = EvalOwner()
    current = ChatClaim(operation_id=str(uuid4()), attempt_id=str(uuid4()), claim_generation=1,
        lease_expires_at=datetime.now(UTC) + timedelta(seconds=30),
        execution_deadline=datetime.now(UTC) + timedelta(seconds=120), payload=case.payload)

    async def execute(model_pool):
        # Evals never read the database: a local tool server serves the case's synthetic library.
        secret = secrets.token_urlsafe(48)
        server = create_mcp_server(secret=secret, read_library=lambda user_id: case.career_library)
        with serve_in_background(server.http_app(path="/mcp", stateless_http=True)) as url:
            await ChatExecutionAdapter(owner, model_pool,
                tool_server=ToolServerConnection(url=url, secret=secret)).execute(current, None)

    if models is not None:
        await execute(models)
    else:
        async with ChatModels(openai_key=os.environ["OPENAI_API_KEY"], typesafe_key=os.environ["TYPESAFE_API_KEY"]) as pool:
            await execute(pool)
    if owner.failure in {"screening_unavailable", "dependency_unavailable", "execution_timeout"}:
        raise RuntimeError(f"Chat evaluation could not execute: {owner.failure}")
    result = owner.result or {}
    return ChatEvalOutput(status="completed" if owner.result else "failed", reply=result.get("reply", ""),
        summary=(result.get("summary_update") or {}).get("text", ""), failure_code=owner.failure,
        known_cost_microdollars=sum(entry.get("cost_microdollars", 0) for usage, _ in owner.receipts.values() for entry in usage),
        accounting_complete=owner.pending == owner.receipts.keys() and not any(incomplete for _, incomplete in owner.receipts.values()))


def run_chat_evals():
    settings = load_settings()
    report = evaluate_dataset(load_chat_dataset, execute_chat_case, name="evals.chat", max_concurrency=1,
        metadata={"model": settings.chat_model, "fallback": settings.generative_fallback_model,
                  "summary_prompt_version": CHAT_SUMMARY_PROMPT_VERSION}, version=CHAT_PROMPT_VERSION)
    if report.failures or report.report_evaluator_failures or any(case.evaluator_failures for case in report.cases):
        raise RuntimeError("Chat evaluation had task or evaluator failures")
    return report


if __name__ == "__main__":
    run_chat_evals()
