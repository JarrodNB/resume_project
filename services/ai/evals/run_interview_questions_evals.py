"""
Description: Evaluates real interview generation/replacement with synthetic evidence.
Run: docker compose run --rm ai python -m evals.run_interview_questions_evals
Index:
    - load_interview_questions_dataset: loads synthetic cases and deterministic checks
    - run_interview_questions_evals: runs agent and quality judges, reports to Logfire
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
    "semantic_variety": "Apply the criterion for the requested count only: when count=5, the five questions address different themes. When count=1, a single question is correct and no within-output variety is required; its intent must differ semantically from EACH excluded question, not merely reword or combine excluded intents. Reusing a category or general competency is allowed when the question explores a clearly different concrete task: labeling stored ingredients differs from weighing ingredients even if both ask about methods. Do not confuse shared category with duplicate intent.",
    "requested_scope": "Honor inputs.set_type (default general). General sets explore career/behavioral themes even for software careers. Technical sets discuss actual practical work, methods/tools, decisions/tradeoffs, problem solving, improvement/quality in the person's occupation, including non-software and sparse skills/education backgrounds. No knowledge quizzes, coding tasks, hypothetical design exercises, or job targeting. Replacements retain their type.",
    "supported_premises": "Every factual premise and presupposition must follow from the library. Questions can invite unknown information but must not assume it exists: 'Describe a time you encountered damaged material' assumes an event; 'how did you verify this improved quality' assumes improvement; 'which tools have you used' assumes tools if only education/skills are supplied. Skills alone do not prove actual projects, archives, conflicts, review processes, or specific work methods. Allow qualified invitations such as 'if any' or 'what have you learned', without treating all interrogative phrasing as automatically grounded. Quotes alone do not justify additional claims. Identify the specific unsupported premise when scoring below 1.",
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
