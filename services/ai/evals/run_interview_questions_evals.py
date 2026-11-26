"""
Description: Evaluates real interview generation/replacement with synthetic evidence.
Run: docker compose run --rm ai-worker python -m evals.run_interview_questions_evals
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
from settings import load_settings

RUBRICS = {
    "recent_practice_variety": "When recent_questions is empty, score 1. Otherwise assess whether the full set explores fresh concrete focuses instead of merely rephrasing recent practice. This is a soft preference: allow a recurring fit introduction, required categories, and reasonable overlap for sparse libraries. Historical repetition is practice, not a structural failure; distinguish these recent questions from hard exclusions.",
    "replacement_intent": "For both count=5 and count=1, every question must avoid the concrete intent of every excluded question and close rewordings. Full sets must still cover all requested categories, choosing a different specific focus within a category rather than banning the whole category. For count=1, replacements retain their requested type and explore a concrete focus distinct from every excluded intent. Do not impose past-story invitations on hypothetical questions or behavioral themes on fit, technical or knowledge questions.",
    "personalization": "Questions meaningfully fit this person's library and level of experience. For BEHAVIORAL invitations, background relevance suffices; do not demand invented specifics or unnatural detail just to avoid a standard interview question. Sparse education/skills may support broadly relevant study or life examples.",
    "semantic_variety": "Apply the criterion for the requested count only: when count=5, the five questions address different themes and every question avoids EACH excluded concrete intent and close rewordings. A shared category or competency alone is not a duplicate, including for introductions that explore clearly different specific background angles. When count=1, a single question is correct and no within-output variety is required; its intent must differ semantically from EACH excluded question, not merely reword or combine excluded intents. Reusing a category or general competency is allowed when the question explores a clearly different concrete task: labeling stored ingredients differs from weighing ingredients even if both ask about methods. Do not confuse shared category with duplicate intent.",
    "requested_scope": "Honor inputs.set_type (default fit_motivation). Fit & motivation covers background, motivation, goals, working preferences and contribution without invented employers or vacancies. Behavioral covers collaboration, problem solving, adaptation, initiative and judgment through real past-example invitations. Hypothetical covers future workplace behavior and judgment: prioritization, ambiguity, disagreement, quality/risk and accountability through clearly proposed situations, never assertions that events happened or unsupported responsibilities. A software or other technical background may supply context, but answers must not depend on specialist knowledge. Penalize technical troubleshooting, system design, implementation steps, tool choices or domain-fact quizzes even when phrased as what-would-you-do scenarios. Communication, teamwork, priorities and responsibility are appropriate. Technical sets discuss actual practical work, methods/tools, decisions/tradeoffs, problem solving, improvement/quality in any occupation, including nonsoftware and sparse backgrounds; no knowledge quizzes or hypothetical design exercises for those scopes. Knowledge sets test subject understanding in library-relevant topics in ALL occupations: concepts, mechanisms, application, reasoning and limitations. Knowledge questions may use clearly hypothetical scenarios and general subject knowledge, and must not require personal stories. No coding execution or job targeting in any scope. Replacements retain their type.",
    "supported_premises": "Career evidence includes inputs.library and the response fields of inputs.career_contexts. A fact's requirement is context for its response's topic or pronouns, never proof of years, leadership or other personal claims. Distinguish an invitation from a personalized factual assertion. BEHAVIORAL questions may use ordinary 'Tell me about a time...' invitations about conflict, setbacks, feedback, initiative or other events not recorded in the library. These do not require 'if any', nor library proof that the event occurred. Background excerpts establish relevance, not the occurrence of the invited event. Still reject fabricated specific incidents, actions, successes, roles or results: 'When you resolved your team's conflict...' asserts an incident; 'how did you verify this improved quality' asserts improvement. Do not require employment or leadership for sparse backgrounds. For TECHNICAL sets, retain strict grounding of personal premises and presuppositions: skills alone do not prove projects, conflicts, methods or tools; invitations to unstated practice must allow none. For HYPOTHETICAL, clearly fictional situations are valid but must not assert past events or unsupported responsibilities. For FIT_MOTIVATION, do not invent motives, goals, employers or vacancies. For KNOWLEDGE, excerpts establish subject relevance, and subject principles and clearly hypothetical scenarios are allowed without personal experience. In every scope quotes alone do not justify extra specific personal claims. Identify the specific unsupported assertion when scoring below 1.",
    "interview_realism": "For BEHAVIORAL, questions sound natural and invite a real story and the candidate's actions or learning. Avoid abstract strengths/goals questions, forced STAR checklists, repetitive multi-part scripts and blanket 'if any' hedging. A conventional conflict or setback invitation is valid. For FIT_MOTIVATION/HYPOTHETICAL/TECHNICAL/KNOWLEDGE, judge clarity and realistic practical/subject interview wording without imposing behavioral stories or STAR.",
    "question_scope_and_difficulty": "For TECHNICAL/KNOWLEDGE, each question should focus on one manageable practical topic, concept, or small application and be answerable in a typical interview. Penalize questions that bundle several independent tasks or design areas, or demand unnecessarily advanced specialist depth relative to the stated background. A short clarifying clause is fine. For FIT_MOTIVATION/BEHAVIORAL/HYPOTHETICAL, judge one manageable question appropriate to the stated background.",
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
        )

    report_interview_evals(load_interview_questions_dataset(), generate,
                          "evals.interview_questions", settings.interview_questions_model,
                          INTERVIEW_QUESTIONS_PROMPT_VERSION, RUBRICS, settings=settings)


if __name__ == "__main__":
    run_interview_questions_evals()
