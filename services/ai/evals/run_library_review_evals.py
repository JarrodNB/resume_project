"""Run bounded synthetic section reviews through production screening and grading.

Colors are compared with hand labels. This small calibration check is not evidence
of broad career-writing quality. Run with python -m evals.run_library_review_evals.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from pydantic_evals import Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from evals.report_capture import override_settings
from evals.telemetry import evaluate_dataset
from prompts.library_review_instructions import LIBRARY_REVIEW_PROMPT_VERSION
from schemas.gap_analysis_context import CareerLibrary
from worker.library_review_handler import handle_library_review_task
from worker.queue_messages import AiTaskMessage
from worker.settings import load_settings
from worker.task_dependencies import TaskDependencies


@dataclass
class ReviewCalibration(Evaluator[CareerLibrary, dict, list[list[str]]]):
    """Check complete coverage and acceptable traffic lights without scoring prose style."""

    def evaluate(self, ctx: EvaluatorContext[CareerLibrary, dict, list[list[str]]]) -> dict[str, float]:
        items = ctx.output.get("assessments", [])
        labels = ctx.metadata or []
        return {"color_calibration": float(len(items) == len(labels) and all(
            item["color"] in accepted for item, accepted in zip(items, labels, strict=True)
        ))}


def load_library_review_dataset():
    return Dataset[CareerLibrary, dict, list[list[str]]].from_file(
        Path(__file__).parent / "datasets" / "library_review_cases.yaml",
        custom_evaluator_types=[ReviewCalibration],
    )


def run_library_review_evals(model_override: str | None = None):
    settings = override_settings(load_settings(), "library_review_model", model_override)
    dependencies = TaskDependencies(settings, None, None, lambda *_: None)

    def review(library: CareerLibrary) -> dict:
        targets = []
        for role in library.experiences:
            digest = hashlib.sha256(role.model_dump_json().encode()).hexdigest()
            if role.description:
                targets.append({"kind": "experience", "record_id": role.id, "field": "description", "source_digest": digest})
            for item in role.highlights:
                targets.append({"kind": "experience_highlight", "record_id": item.id, "field": "content", "source_digest": digest})
        section = "experience"
        if library.summary:
            section = "summary"
            targets.append({"kind": "user", "record_id": library.summary_record_id or "user-1", "field": "summary",
                            "source_digest": hashlib.sha256(library.summary.encode()).hexdigest()})
        for name, kind, field in [("projects", "project", "description"), ("facts", "library_fact", "response")]:
            for record in getattr(library, name):
                if getattr(record, field):
                    section = name
                    targets.append({"kind": kind, "record_id": record.id, "field": field,
                                    "source_digest": hashlib.sha256(record.model_dump_json().encode()).hexdigest()})
        for index, target in enumerate(targets):
            target["label"] = f"T{index + 1}"
        result = handle_library_review_task(AiTaskMessage(
            ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section",
            input={"section": section, "library": library.model_dump(mode="json"), "targets": targets},
        ), dependencies)
        if result.status != "completed":
            raise RuntimeError(result.error_message or "Section review failed")
        return result.result

    return evaluate_dataset(
        load_library_review_dataset, review, name="evals.library_review",
        metadata={"model": settings.library_review_model, "prompt_version": LIBRARY_REVIEW_PROMPT_VERSION},
        version=LIBRARY_REVIEW_PROMPT_VERSION, tags=["eval", "library_review"],
        max_concurrency=1,
    )


if __name__ == "__main__":
    run_library_review_evals()
