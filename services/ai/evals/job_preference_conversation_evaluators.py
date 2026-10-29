"""Small deterministic priority and clarification signals for synthetic preference dialogue."""
from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator

from schemas.job_preference_conversation import JobPreferenceProposal


class PreferenceConversationCase(BaseModel):
    message: str
    answer: str | None = None


class PreferenceConversationExpectations(BaseModel):
    requires_question: bool = False
    required: dict[str, str] = Field(default_factory=dict)
    forbidden_terms: list[str] = Field(default_factory=list)


class PreferenceConversationOutput(BaseModel):
    proposal: JobPreferenceProposal
    question: str | None = None
    known_cost_microdollars: int = 0
    accounting_complete: bool = True
    requests: int = 0


@dataclass
class PreferenceConversationOutcome(Evaluator[PreferenceConversationCase, PreferenceConversationOutput, PreferenceConversationExpectations]):
    def evaluate(self, ctx):
        expected = ctx.metadata or PreferenceConversationExpectations()
        actual = ctx.output
        text = " ".join(item.text.casefold() for item in actual.proposal.criteria)
        priority_correct = all(any(term.casefold() in item.text.casefold() and item.priority == priority
            for item in actual.proposal.criteria) for term, priority in expected.required.items())
        return {"clarification_route": float(bool(actual.question) == expected.requires_question),
            "stated_preferences_and_priorities": float(priority_correct),
            "unsupported_preferences_absent": float(not any(term.casefold() in text for term in expected.forbidden_terms))}
