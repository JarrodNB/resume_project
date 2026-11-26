"""Synthetic career-chat outcome and continuity signals, separate from model inputs.

These deterministic checks catch missing facts, obvious unsupported-action claims and
missing or unneeded tool use. Tool use is recorded by the eval's fake readers, so it counts
tools that reached their reader, not every attempted call. They are bounded regression
signals, not a general assessment of writing quality.
"""
from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator

from chat.client import ChatPayload
from schemas.gap_analysis_context import CareerLibrary


class ChatEvalInput(BaseModel):
    saved_jobs: list[dict] = Field(default_factory=list)
    payload: ChatPayload
    # Synthetic saved library the read_career_library tool returns; empty when omitted.
    career_library: CareerLibrary = Field(default_factory=CareerLibrary)
    # Synthetic practice-question rows (reader shape), with optional answer_text, answer_format and
    # feedback, that list_interview_questions and read_interview_question return.
    interview_questions: list[dict] = Field(default_factory=list)


class ChatEvalExpectations(BaseModel):
    expects_context_save: bool = False
    required_context_terms: list[str] = Field(default_factory=list)
    forbidden_context_terms: list[str] = Field(default_factory=list)
    expects_block: bool = False
    required_reply_terms: list[str] = Field(default_factory=list)
    # At least one of these must appear, for honest answers that can be worded several ways.
    required_any_reply_terms: list[str] = Field(default_factory=list)
    required_summary_terms: list[str] = Field(default_factory=list)
    forbidden_reply_terms: list[str] = Field(default_factory=list)
    # Tool names, such as list_saved_jobs, the reply must or must not have read through.
    required_tool_calls: list[str] = Field(default_factory=list)
    forbidden_tool_calls: list[str] = Field(default_factory=list)


class ChatEvalOutput(BaseModel):
    career_contexts: list[dict[str, str]] = Field(default_factory=list)
    status: str
    reply: str = ""
    summary: str = ""
    failure_code: str | None = None
    known_cost_microdollars: int = 0
    accounting_complete: bool = True
    # Tools whose synthetic reader ran, in call order.
    tool_calls: list[str] = Field(default_factory=list)


def _comparable(text):
    """Ignore case and curly quotes, so "doesn’t" matches the label "doesn't"."""
    return text.casefold().replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')


def _has(text, term):
    return _comparable(term) in text


@dataclass
class CareerChatOutcome(Evaluator[ChatEvalInput, ChatEvalOutput, ChatEvalExpectations]):
    def evaluate(self, ctx):
        expected = ctx.metadata or ChatEvalExpectations()
        actual = ctx.output
        if expected.expects_block:
            return {"expected_outcome": float(actual.status == "failed" and actual.failure_code == "screening_blocked")}
        context = _comparable(" ".join(value for entry in actual.career_contexts for value in entry.values()))
        reply, summary = _comparable(actual.reply), _comparable(actual.summary)
        return {
            "career_context_save_policy": float(bool(actual.career_contexts) == expected.expects_context_save),
            "career_context_evidence": float(all(_has(context, term) for term in expected.required_context_terms) and not any(_has(context, term) for term in expected.forbidden_context_terms)),
            "expected_outcome": float(actual.status == "completed" and bool(reply.strip())),
            "reply_continuity": float(all(_has(reply, term) for term in expected.required_reply_terms)
                and (not expected.required_any_reply_terms or any(_has(reply, term) for term in expected.required_any_reply_terms))),
            "summary_continuity": float(all(_has(summary, term) for term in expected.required_summary_terms)),
            "unsupported_action_claims_absent": float(not any(_has(reply, term) for term in expected.forbidden_reply_terms)),
            "tool_use_policy": float(set(expected.required_tool_calls) <= set(actual.tool_calls)
                and not set(expected.forbidden_tool_calls) & set(actual.tool_calls)),
        }
