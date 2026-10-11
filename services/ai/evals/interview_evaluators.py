"""
Description: Deterministic interview structure checks and synthetic evaluation inputs.
Index:
    - QuestionEvalInput / FeedbackEvalInput: synthetic agent inputs
    - FeedbackEvalLabels: trusted expectations separate from agent input
    - QuestionStructure / FeedbackStructure: deterministic scores
    - question_context / feedback_context: production-shaped prompts
"""
import json
from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from schemas.interview_feedback import InterviewFeedback, InterviewFeedbackContext
from schemas.interview_questions import (
    InterviewQuestionContext,
    InterviewQuestions,
    normalize_question,
)


class QuestionEvalInput(BaseModel):
    """Synthetic usable library and replacement exclusions."""

    library: str
    count: int = Field(default=5, ge=1, le=5)
    excluded: list[str] = Field(default_factory=list)


class FeedbackEvalInput(BaseModel):
    """Synthetic saved answer with optional career evidence."""

    question: str
    answer: str
    library: str = ""


class FeedbackEvalLabels(BaseModel):
    """Trusted dataset expectations used only by deterministic checks."""

    needs_placeholder: bool = False


def question_context(case: QuestionEvalInput) -> InterviewQuestionContext:
    """Uses the worker's question prompt shape with trusted synthetic evidence."""
    text = f"Generate {case.count} questions.\nLibrary JSON data:\n{json.dumps({'summary': case.library})}"
    if case.excluded:
        text += "\nExcluded questions JSON data:\n" + json.dumps(case.excluded)
    return InterviewQuestionContext(text, case.library, case.count, tuple(case.excluded))


def feedback_context(case: FeedbackEvalInput) -> InterviewFeedbackContext:
    """Uses the worker's feedback prompt shape without test-only labels."""
    text = json.dumps({"question": case.question, "answer": case.answer,
                       "career_library": {"summary": case.library}})
    return InterviewFeedbackContext(text, case.answer + "\n" + case.library)


@dataclass
class QuestionStructure(Evaluator[QuestionEvalInput, InterviewQuestions, None]):
    """Checks counts, categories, normalized uniqueness and exact evidence."""

    def evaluate(self, ctx: EvaluatorContext[QuestionEvalInput, InterviewQuestions, None]) -> dict[str, float]:
        """Returns separate scores so structural failures remain visible."""
        questions = ctx.output.questions
        keys = [normalize_question(q.question_text) for q in questions]
        excluded = {normalize_question(text) for text in ctx.inputs.excluded}
        checks = {
            "question_count": len(questions) == ctx.inputs.count,
            "category_variety": ctx.inputs.count != 5 or len({q.category for q in questions}) == 5,
            "distinct_wording": len(set(keys)) == len(keys) and not excluded.intersection(keys),
            "question_evidence": all(q.evidence_quotes and all(
                quote.strip() and quote in ctx.inputs.library for quote in q.evidence_quotes
            ) for q in questions),
        }
        return {name: float(passed) for name, passed in checks.items()}


@dataclass
class FeedbackStructure(Evaluator[FeedbackEvalInput, InterviewFeedback, FeedbackEvalLabels]):
    """Checks nonblank coaching, exact excerpts, and required explicit placeholders."""

    def evaluate(self, ctx: EvaluatorContext[FeedbackEvalInput, InterviewFeedback, FeedbackEvalLabels]) -> dict[str, float]:
        """Returns structural scores independently of subjective grounding."""
        import re

        output = ctx.output
        source = ctx.inputs.answer + "\n" + ctx.inputs.library
        checks = {
            "nonblank_feedback": all(text.strip() for text in [
                *output.strengths, *output.improvements, output.example_answer]),
            "focused_coaching": len(output.strengths) <= 3 and len(output.improvements) <= 3,
            "concise_example": len(output.example_answer.split()) <= 120 and len(output.example_answer) <= 1000,
            "limited_placeholders": len(re.findall(r"\[[^\[\]]*\]", output.example_answer)) <= 2,
            "feedback_evidence": all(quote.strip() and quote in source for quote in output.evidence_quotes),
            "missing_fact_placeholder": not (ctx.metadata and ctx.metadata.needs_placeholder) or bool(
                re.search(r"\[[^\[\]]*\w[^\[\]]*\]", output.example_answer)),
        }
        return {name: float(passed) for name, passed in checks.items()}
