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
from evals.report_capture import override_settings
from prompts.interview_question_instructions import INTERVIEW_QUESTIONS_PROMPT_VERSION
from schemas.interview_questions import InterviewQuestions
from worker.settings import load_settings

RUBRICS = {
    "replacement_intent": "For both count=5 and count=1, every question must avoid the concrete intent of every excluded question and close rewordings. Full sets must still cover all requested categories, choosing a different specific focus within a category rather than banning the whole category. For count=1, GENERAL replacements must use a behavioral story theme, not introduction, career background, enjoyment, interest in the role or motivation. Treat those broad personal-overview questions as the same excluded introduction intent even if their wording differs. A valid behavioral category alone does not rescue a question that repeats an excluded story focus. TECHNICAL/KNOWLEDGE replacements retain their existing practical/subject scope and avoid excluded intents without imposing behavioral themes.",
    "personalization": "Questions meaningfully fit this person's library and level of experience. For GENERAL behavioral invitations, background relevance suffices; do not demand invented specifics or unnatural detail just to avoid a standard interview question. Sparse education/skills may support broadly relevant study or life examples.",
    "semantic_variety": "Apply the criterion for the requested count only: when count=5, the five questions address different themes and every question avoids EACH excluded concrete intent and close rewordings. A shared category or competency alone is not a duplicate, including for introductions that explore clearly different specific background angles. When count=1, a single question is correct and no within-output variety is required; its intent must differ semantically from EACH excluded question, not merely reword or combine excluded intents. Reusing a category or general competency is allowed when the question explores a clearly different concrete task: labeling stored ingredients differs from weighing ingredients even if both ask about methods. Do not confuse shared category with duplicate intent.",
    "requested_scope": "Honor inputs.set_type (default general). A GENERAL full set contains one introduction and four distinct behavioral story focuses: collaboration, problem solving, learning/adaptation, and initiative/judgment, even for software careers. A GENERAL replacement retains behavioral/career scope without requiring a full-set composition. Technical sets discuss actual practical work, methods/tools, decisions/tradeoffs, problem solving, improvement/quality in any occupation, including nonsoftware and sparse backgrounds; no knowledge quizzes or hypothetical design exercises for those scopes. Knowledge sets test subject understanding in library-relevant topics in ALL occupations: concepts, mechanisms, application, reasoning and limitations. Knowledge questions may use clearly hypothetical scenarios and general subject knowledge, and must not require personal stories. No coding execution or job targeting in any scope. Replacements retain their type.",
    "supported_premises": "Career evidence includes inputs.library and the response fields of inputs.facts. A fact's requirement is context for its response's topic or pronouns, never proof of years, leadership or other personal claims. Distinguish an invitation from a personalized factual assertion. GENERAL questions may use ordinary 'Tell me about a time...' invitations about conflict, setbacks, feedback, initiative or other events not recorded in the library. These do not require 'if any', nor library proof that the event occurred. Background excerpts establish relevance, not the occurrence of the invited event. Still reject fabricated specific incidents, actions, successes, roles or results: 'When you resolved your team's conflict...' asserts an incident; 'how did you verify this improved quality' asserts improvement. Do not require employment or leadership for sparse backgrounds. For TECHNICAL sets, retain strict grounding of personal premises and presuppositions: skills alone do not prove projects, conflicts, methods or tools; invitations to unstated practice must allow none. For KNOWLEDGE, excerpts establish subject relevance, and subject principles and clearly hypothetical scenarios are allowed without personal experience. In every scope quotes alone do not justify extra specific personal claims. Identify the specific unsupported assertion when scoring below 1.",
    "interview_realism": "For GENERAL, questions sound like clear, natural interview questions that invite a concrete real story and the candidate's own actions, decisions or learning; the introduction remains a natural introduction. Avoid abstract strengths/goals questions in the four behavioral slots, forced STAR checklists, repetitive multi-part scripts and blanket 'if any' hedging. A conventional conflict or setback invitation is valid. For TECHNICAL/KNOWLEDGE, judge clarity and realistic practical/subject interview wording without imposing behavioral stories or STAR.",
}


def load_interview_questions_dataset() -> Dataset[QuestionEvalInput, InterviewQuestions, None]:
    """Loads synthetic cases without model judges for offline tests."""
    return Dataset[QuestionEvalInput, InterviewQuestions, None].from_file(
        Path(__file__).parent / "datasets/interview_questions_cases.yaml",
        custom_evaluator_types=(QuestionStructure,),
    )


def run_interview_questions_evals(model_override: str | None = None) -> None:
    """Runs configured production agent settings and subjective quality evaluation."""
    settings = override_settings(load_settings(), "interview_questions_model", model_override)

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
                          INTERVIEW_QUESTIONS_PROMPT_VERSION, RUBRICS, settings=settings)


if __name__ == "__main__":
    run_interview_questions_evals()
