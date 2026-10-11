"""
Description: Evaluates real interview generation/replacement with synthetic evidence.
Run: docker compose run --rm ai python -m evals.run_interview_questions_evals
Index:
    - load_interview_questions_dataset: loads synthetic cases and deterministic checks
    - run_interview_questions_evals: runs agent and quality judges, reports to Langfuse
"""
from pathlib import Path

from pydantic_evals import Dataset

from agents.interview_questions_agent import generate_interview_questions
from evals.interview_eval_reporting import report_interview_evals
from evals.interview_evaluators import QuestionEvalInput, QuestionStructure, question_context
from prompts.interview_question_instructions import INTERVIEW_QUESTIONS_PROMPT_VERSION
from schemas.interview_questions import InterviewQuestions
from worker.settings import load_settings

RUBRICS = {
    "personalization": "Questions meaningfully use this person's library rather than generic templates.",
    "semantic_variety": "Apply the criterion for the requested count only: when count=5, the five questions address different themes. When count=1, a single question is correct and no within-output variety is required; its intent must differ semantically from EACH excluded question, not merely reword or combine excluded intents.",
    "nontechnical_scope": "All questions are English general interviews, without technical quizzes or job-specific assumptions.",
    "supported_premises": "Every factual premise is supported by the library. Quotes alone do not justify invented leadership, achievements, goals or weaknesses. Open questions are allowed.",
}


def load_interview_questions_dataset() -> Dataset[QuestionEvalInput, InterviewQuestions, None]:
    """Loads synthetic cases without model judges for offline tests."""
    return Dataset[QuestionEvalInput, InterviewQuestions, None].from_file(
        Path(__file__).parent / "datasets/interview_questions_cases.yaml",
        custom_evaluator_types=(QuestionStructure,),
    )


def run_interview_questions_evals() -> None:
    """Runs configured production agent settings and subjective quality evaluation."""
    settings = load_settings()

    def generate(case: QuestionEvalInput) -> InterviewQuestions:
        """Runs generation or replacement with production limits and validation."""
        return generate_interview_questions(
            question_context(case), model=settings.interview_questions_model,
            thinking=settings.interview_questions_thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        ).questions

    report_interview_evals(load_interview_questions_dataset(), generate,
                          "evals.interview_questions", settings.interview_questions_model,
                          INTERVIEW_QUESTIONS_PROMPT_VERSION, RUBRICS)


if __name__ == "__main__":
    run_interview_questions_evals()
