"""Evaluate the complete writer/render/editorial-review workflow on synthetic libraries.

Deterministic measurements check contracts; an independent quality judge assesses
relevance, grounding and usefulness of both the draft and its separate editorial review.
"""

import asyncio
from pathlib import Path
from uuid import uuid4

from pydantic_evals import Dataset
from pydantic_evals.evaluators import LLMJudge

from evals.report_capture import override_settings
from evals.tailoring_evaluators import (
    MeasuredResumeContract,
    ResumeDocumentEvalInput,
    ResumeDocumentEvalOutput,
)
from evals.telemetry import evaluate_dataset
from prompts.resume_document_instructions import RESUME_DOCUMENT_PROMPT_VERSION
from tailoring.generate_resume_draft import generate_resume_draft
from tailoring.tailor_resume_input import TailorResumeInput
from worker.settings import load_settings
from worker.task_dependencies import TaskDependencies

DATASET_PATH = Path(__file__).parent / "datasets" / "resume_document_cases.yaml"
TRACE_NAME = "evals.tailoring"


def load_tailoring_dataset():
    dataset = Dataset[ResumeDocumentEvalInput, ResumeDocumentEvalOutput].from_file(DATASET_PATH)
    dataset.add_evaluator(MeasuredResumeContract())
    return dataset


def run_tailoring_evals(model_override: str | None = None):
    settings = override_settings(load_settings(), "resume_tailoring_model", model_override)
    dataset = load_tailoring_dataset()
    dataset.add_evaluator(
        LLMJudge(
            rubric="Evaluate the complete resume and its independent editorial review against the supplied job and full library. "
            "The resume should prioritize relevant evidence, remain faithful to available facts, be clear and nonrepetitive, "
            "and cover relevant job needs without inventing expertise or outcomes. Sparse/unrelated libraries must not be "
            "inflated into job-specific qualifications. The editorial feedback should detect material omissions, unsupported "
            "claims, repetition and poor coverage and explain sufficiency honestly. Cite concrete output clauses in your reason.",
            model=settings.eval_judge_model,
            include_input=True,
            model_settings={"timeout": settings.llm_run_timeout_seconds},
            score={"evaluation_name": "resume_and_editorial_quality", "include_reason": True},
            assertion=False,
        )
    )

    def write_case(case):
        dependencies = TaskDependencies(
            settings=settings,
            file_storage=None,
            http_client=None,
            read_gap_analysis_context=lambda *_: case.context,
        )
        draft = asyncio.run(
            generate_resume_draft(
                uuid4(),
                TailorResumeInput(
                    job_id=uuid4(), target_pages=case.target_pages, contact=case.contact
                ),
                dependencies,
                usage=[],
            )
        )
        return ResumeDocumentEvalOutput(
            markdown=draft.markdown,
            **draft.measurements,
            editorial_review=draft.editorial_review,
            warnings=draft.warnings,
            drafts=draft.drafts,
        )

    return evaluate_dataset(
        lambda: dataset,
        write_case,
        name=TRACE_NAME,
        metadata={
            "model": settings.resume_tailoring_model,
            "judge_model": settings.eval_judge_model,
            "prompt_version": RESUME_DOCUMENT_PROMPT_VERSION,
        },
        version=RESUME_DOCUMENT_PROMPT_VERSION,
        tags=["eval", "tailor_resume"],
        evaluation_name=f"tailoring:{settings.resume_tailoring_model}",
        max_concurrency=1,
    )


if __name__ == "__main__":
    run_tailoring_evals()
