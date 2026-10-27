"""
Check interview output structure against synthetic evaluation inputs.

Question cases use the production context builder so prompt text and citation evidence
stay aligned. Evaluation labels remain separate from model-facing inputs.
"""
from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from model_inputs.interview import build_interview_question_context, format_feedback_prompt
from model_inputs.interview_evidence import interview_career_evidence
from schemas.gap_analysis_context import CareerLibrary, LibraryFact
from schemas.interview_feedback import InterviewFeedback, InterviewFeedbackContext
from schemas.interview_questions import (
    QUESTION_CATEGORIES,
    InterviewQuestionContext,
    InterviewQuestions,
    InterviewSetType,
    normalize_question,
)


class QuestionEvalInput(BaseModel):
    """Synthetic library, hard exclusions, and optional soft recent-practice context."""

    library: str = ""
    facts: list[LibraryFact] = Field(default_factory=list)
    set_type: InterviewSetType = "general"
    count: int = Field(default=5, ge=1, le=5)
    excluded: list[str] = Field(default_factory=list)
    recent_questions: list[str] = Field(default_factory=list)


class FeedbackEvalInput(BaseModel):
    """Synthetic saved answer with optional career evidence."""

    question: str
    set_type: InterviewSetType = "general"
    answer: str
    library: str = ""
    facts: list[LibraryFact] = Field(default_factory=list)


class FeedbackEvalLabels(BaseModel):
    """Trusted dataset expectations used only by deterministic checks."""

    needs_placeholder: bool = False


def question_context(case: QuestionEvalInput) -> InterviewQuestionContext:
    """Uses the worker's question prompt shape with trusted synthetic evidence."""
    library = CareerLibrary(summary=case.library, facts=case.facts)
    return build_interview_question_context(
        library, case.excluded, case.count, case.set_type, recent_questions=case.recent_questions,
    )


def feedback_context(case: FeedbackEvalInput) -> InterviewFeedbackContext:
    """Uses the worker's feedback prompt shape without test-only labels."""
    library = CareerLibrary(summary=case.library or None, facts=case.facts)
    text = format_feedback_prompt(case.set_type, case.question, case.answer, library)
    return InterviewFeedbackContext(text, case.answer + "\n" + interview_career_evidence(library)[1], case.set_type)


@dataclass
class QuestionStructure(Evaluator[QuestionEvalInput, InterviewQuestions, None]):
    """Checks counts, categories, normalized uniqueness and exact evidence."""

    def evaluate(self, ctx: EvaluatorContext[QuestionEvalInput, InterviewQuestions, None]) -> dict[str, float]:
        """Returns separate scores so structural failures remain visible."""
        questions = ctx.output.questions
        source = question_context(ctx.inputs).library_text
        keys = [normalize_question(q.question_text) for q in questions]
        excluded = {normalize_question(text) for text in ctx.inputs.excluded}
        checks = {
            "question_count": len(questions) == ctx.inputs.count,
            "category_variety": all(q.category in QUESTION_CATEGORIES[ctx.inputs.set_type] for q in questions)
            and (ctx.inputs.count != 5 or len({q.category for q in questions}) == 5)
            and not (ctx.inputs.set_type == "general" and ctx.inputs.count == 1
                     and any(q.category == "introduction" for q in questions)),
            "distinct_wording": len(set(keys)) == len(keys) and not excluded.intersection(keys),
            "question_evidence": all(q.evidence_quotes and all(
                quote.strip() and quote in source for quote in q.evidence_quotes
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
        source = feedback_context(ctx.inputs).source_text
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
