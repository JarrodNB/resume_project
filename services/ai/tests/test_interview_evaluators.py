"""
Description: Exercises interview dataset checks offline with good and deliberately bad output.
Index:
    - test_question_structure: counts, variety, exclusions and unsupported quotes
    - test_feedback_structure: blank coaching, invented evidence and missing placeholders
    - test_reporting_errors: runner fails and flushes on case or judge errors
"""
import asyncio
from types import SimpleNamespace

import pytest

from evals import interview_eval_reporting, telemetry
from evals.interview_evaluators import FeedbackStructure, QuestionStructure
from evals.run_interview_feedback_evals import load_interview_feedback_dataset
from evals.run_interview_questions_evals import load_interview_questions_dataset
from schemas.interview_feedback import InterviewFeedback
from schemas.interview_questions import (
    QUESTION_CATEGORIES,
    InterviewQuestionDraft,
    InterviewQuestions,
)


def test_knowledge_accuracy_skips_other_scopes(monkeypatch):
    """Nonknowledge cases cannot be misgraded by the subject-accuracy model judge."""
    seen = []

    async def judge(self, context):
        """Records applicable model judgments without making a provider request."""
        seen.append(context.inputs.set_type)
        return {"knowledge_accuracy": 0.5}

    monkeypatch.setattr(interview_eval_reporting.LLMJudge, "evaluate", judge)
    evaluator = interview_eval_reporting.KnowledgeAccuracyJudge(rubric="Subject correctness")
    for set_type in ("general", "technical", "knowledge"):
        context = SimpleNamespace(inputs=SimpleNamespace(set_type=set_type))
        scores = asyncio.run(evaluator.evaluate(context))
        assert scores == ({"knowledge_accuracy": 0.5} if set_type == "knowledge" else {})
    assert seen == ["knowledge"]


def test_question_structure() -> None:
    """Good cases pass while wrong counts, categories, repeats and evidence fail."""
    dataset = load_interview_questions_dataset()
    assert len(dataset.cases) == 13
    for case in dataset.cases:
        output = InterviewQuestions(questions=[InterviewQuestionDraft(
            question_text=f"What can you share about career theme number {index}?",
            category=category, evidence_quotes=[case.inputs.library],
        ) for index, category in enumerate(
            QUESTION_CATEGORIES[case.inputs.set_type][:case.inputs.count])])
        context = SimpleNamespace(inputs=case.inputs, output=output, metadata=case.metadata)
        assert all(QuestionStructure().evaluate(context).values())
        output.questions[0].evidence_quotes = ["Invented management promotion"]
        assert not QuestionStructure().evaluate(context)["question_evidence"]
        if case.inputs.count == 5:
            output.questions[1] = output.questions[0]
            scores = QuestionStructure().evaluate(context)
            assert not scores["distinct_wording"] and not scores["category_variety"]
            output.questions.pop()
            assert not QuestionStructure().evaluate(context)["question_count"]
        else:
            output.questions[0].question_text = case.inputs.excluded[0].upper() + "!"
            assert not QuestionStructure().evaluate(context)["distinct_wording"]


def test_feedback_structure() -> None:
    """Required placeholders and exact evidence cannot pass on invented or blank data."""
    dataset = load_interview_feedback_dataset()
    assert len(dataset.cases) == 13
    for case in dataset.cases:
        output = InterviewFeedback(strengths=["You identified a theme."],
                                   improvements=["Explain your own actions."],
                                   example_answer="[Describe your actual actions and outcome]",
                                   evidence_quotes=[case.inputs.answer])
        context = SimpleNamespace(inputs=case.inputs, output=output, metadata=case.metadata)
        assert all(FeedbackStructure().evaluate(context).values())
        output.evidence_quotes = ["Increased revenue by 40%"]
        assert not FeedbackStructure().evaluate(context)["feedback_evidence"]
        output.strengths = [" "]
        assert not FeedbackStructure().evaluate(context)["nonblank_feedback"]
        output.example_answer = "I increased revenue by 40%."
        if case.metadata and case.metadata.needs_placeholder:
            assert not FeedbackStructure().evaluate(context)["missing_fact_placeholder"]


@pytest.mark.parametrize("field, value, score", [
    ("strengths", ["Clear"] * 4, "focused_coaching"),
    ("example_answer", "word " * 121, "concise_example"),
    ("example_answer", "[Add context] [Add action] [Add outcome]", "limited_placeholders"),
])
def test_feedback_focus_limits(field, value, score) -> None:
    """Flags excessive coaching, long examples, and placeholder checklists."""
    output = InterviewFeedback(strengths=["Clear action"], improvements=["Add context"],
                               example_answer="I made a checklist.")
    setattr(output, field, value)
    context = SimpleNamespace(inputs=SimpleNamespace(answer="I made a checklist.", library=""),
                              output=output, metadata=None)
    assert not FeedbackStructure().evaluate(context)[score]


@pytest.mark.parametrize("failure_kind", ["case", "judge", "report", "none"])
def test_reporting_errors(monkeypatch, failure_kind) -> None:
    """Case and judge failures cannot silently yield a successful run; traces always flush."""
    scores = []
    flushed = []
    report = SimpleNamespace(
        failures=["error"] if failure_kind == "case" else [],
        report_evaluator_failures=["error"] if failure_kind == "report" else [],
        cases=[SimpleNamespace(
            name="synthetic", output=InterviewFeedback(strengths=["Clear theme"],
                improvements=["Add details"], example_answer="[Add actual details]"),
            evaluator_failures=["error"] if failure_kind == "judge" else [],
        )],
        averages=lambda: SimpleNamespace(scores={"quality": 0.8}),
        print=lambda **kwargs: None,
    )
    dataset = SimpleNamespace(evaluate_sync=lambda *args, **kwargs: report)
    monkeypatch.setattr(interview_eval_reporting, "configure_tracing", lambda **kwargs: None)
    monkeypatch.setattr(interview_eval_reporting, "record_score",
                        lambda **kwargs: scores.append(kwargs))
    monkeypatch.setattr(telemetry, "flush_tracing", lambda: flushed.append(True))
    if failure_kind == "none":
        interview_eval_reporting.report_interview_evals(dataset, None, "test", "test", "v1", {})
    else:
        with pytest.raises(RuntimeError, match="1 interview case or evaluator errors"):
            interview_eval_reporting.report_interview_evals(dataset, None, "test", "test", "v1", {})
    assert flushed == [True]
    assert {"name": "case_errors", "value": int(failure_kind != "none")} in scores
