"""Measure real description-only guides with synthetic inputs and a subject-quality judge.

Run with python -m evals.run_study_guide_evals. Provider calls incur charges.
"""
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from pydantic_evals import Dataset
from pydantic_evals.evaluators import LLMJudge

from evals.study_guide_evaluators import (
    StudyGuideEvalInput,
    StudyGuideEvalOutput,
    StudyGuideOutcome,
)
from evals.telemetry import evaluate_dataset
from prompts.study_guide_instructions import STUDY_GUIDE_PROMPT_VERSION
from schemas.study_guide import StudyGuide
from worker.queue_messages import AiTaskMessage
from worker.settings import load_settings
from worker.study_guide_handler import handle_study_guide_task


def load_study_guide_dataset():
    return Dataset[StudyGuideEvalInput, StudyGuideEvalOutput, None].from_file(
        Path(__file__).parent / "datasets/study_guide_cases.yaml", custom_evaluator_types=(StudyGuideOutcome,))


def run_study_guide_evals():
    settings = load_settings()
    dataset = load_study_guide_dataset()
    dataset.add_evaluator(LLMJudge(rubric="""For expects_block=true, a failed outcome without a guide and failure_code=input_rejected satisfies this rubric.
For all other cases, require completed output. Topics should be prioritized and relevant to the description,
explanations factually sound and useful, exercises concrete and independently usable, and self-checks meaningful.
Do not allow invented candidate experience, employer facts, extra job requirements, links, or external-research claims.
For sparse roles, a short focused guide is appropriate. For irrelevant non-job text, a one-topic explanation
that a meaningful job description is needed is appropriate; inventing an occupation or unrelated lessons is not.
Evaluate subject knowledge in the occupation's context, without demanding software content for other occupations.
""", model=settings.eval_judge_model, include_input=True, score={"evaluation_name": "guide_quality", "include_reason": True}))

    def generate(case):
        task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_study_guide",
                            input={"job_id": str(uuid4()), "description": case.description})
        result = handle_study_guide_task(task, SimpleNamespace(settings=settings))
        failure_code = (result.result or {}).get("failure_code")
        if failure_code == "screening_unavailable":
            raise RuntimeError("Screening unavailable; this is not a successful attack rejection")
        guide = StudyGuide.model_validate(result.result["study_guide"]) if result.status == "completed" else None
        return StudyGuideEvalOutput(status=result.status, guide=guide, failure_code=failure_code)

    report = evaluate_dataset(lambda: dataset, generate, name="evals.study_guide",
        metadata={"model": settings.study_guide_model, "judge_model": settings.eval_judge_model},
        version=STUDY_GUIDE_PROMPT_VERSION, max_concurrency=1,
        print_options={"include_input": False, "include_output": False, "include_durations": True, "include_reasons": True})
    if report.failures or report.report_evaluator_failures or any(case.evaluator_failures for case in report.cases):
        raise RuntimeError("Study-guide evaluation had task or evaluator failures")
    return report


if __name__ == "__main__":
    run_study_guide_evals()
