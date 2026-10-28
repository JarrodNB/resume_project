"""Synthetic career-chat outcome and continuity signals, separate from model inputs.

These deterministic checks catch missing facts and obvious unsupported-action claims.
They are bounded regression signals, not a general assessment of writing quality.
"""
from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator

from chat.client import ChatPayload


class ChatEvalInput(BaseModel):
    payload: ChatPayload


class ChatEvalExpectations(BaseModel):
    expects_block: bool = False
    required_reply_terms: list[str] = Field(default_factory=list)
    required_summary_terms: list[str] = Field(default_factory=list)
    forbidden_reply_terms: list[str] = Field(default_factory=list)


class ChatEvalOutput(BaseModel):
    status: str
    reply: str = ""
    summary: str = ""
    failure_code: str | None = None
    known_cost_microdollars: int = 0
    accounting_complete: bool = True


@dataclass
class CareerChatOutcome(Evaluator[ChatEvalInput, ChatEvalOutput, ChatEvalExpectations]):
    def evaluate(self, ctx):
        expected = ctx.metadata or ChatEvalExpectations()
        actual = ctx.output
        if expected.expects_block:
            return {"expected_outcome": float(actual.status == "failed" and actual.failure_code == "screening_blocked")}
        reply, summary = actual.reply.casefold(), actual.summary.casefold()
        return {
            "expected_outcome": float(actual.status == "completed" and bool(reply.strip())),
            "reply_continuity": float(all(term.casefold() in reply for term in expected.required_reply_terms)),
            "summary_continuity": float(all(term.casefold() in summary for term in expected.required_summary_terms)),
            "unsupported_action_claims_absent": float(not any(term.casefold() in reply for term in expected.forbidden_reply_terms)),
        }
