"""Run three bounded synthetic preference conversations through production screening.

Calls configured providers, with at most one clarification answer per case and no
Rails writes. Deterministic signals are regression evidence, not broad quality proof.
Run python -m evals.run_job_preference_conversation_evals.
"""
import json
from pathlib import Path
from uuid import uuid4

from pydantic_evals import Dataset

from evals.job_preference_conversation_evaluators import (
    PreferenceConversationCase,
    PreferenceConversationExpectations,
    PreferenceConversationOutcome,
    PreferenceConversationOutput,
)
from evals.telemetry import evaluate_dataset
from llm.usage import collect_task_usage
from prompts.job_preference_conversation_instructions import (
    JOB_PREFERENCE_CONVERSATION_PROMPT_VERSION,
)
from worker.job_preference_conversation_handler import handle_job_preference_conversation_task
from worker.queue_messages import AiTaskMessage
from worker.settings import load_settings
from worker.task_dependencies import TaskDependencies


def load_preference_conversation_dataset():
    return Dataset[PreferenceConversationCase, PreferenceConversationOutput, PreferenceConversationExpectations].from_file(
        Path(__file__).parent / "datasets/job_preference_conversation_cases.yaml",
        custom_evaluator_types=[PreferenceConversationOutcome])


def run_preference_conversation_evals():
    settings = load_settings().model_copy(update={"llm_run_timeout_seconds": 60})
    dependencies = TaskDependencies(settings, None, None, lambda *_: None)
    observed = []

    def execute(case):
        task_id, owner = uuid4(), uuid4()
        payload = {"profile_version": 0, "criteria": [], "message": case.message, "history": [], "turn": 1}
        with collect_task_usage() as usage:
            result = handle_job_preference_conversation_task(AiTaskMessage(ai_task_id=task_id, user_id=owner,
                task_type="elicit_job_preferences", input=payload), dependencies)
            question = None
            if result.status == "needs_user_input":
                question = result.pending_questions[0]["question"]
                if case.answer is None:
                    raise RuntimeError("Unexpected clarification: " + question)
                payload.update(history=result.message_history, previous_task_id=str(task_id),
                    question_id=result.pending_questions[0]["id"], message=case.answer, turn=2)
                result = handle_job_preference_conversation_task(AiTaskMessage(ai_task_id=uuid4(), user_id=owner,
                    task_type="elicit_job_preferences", input=payload), dependencies)
            if result.status != "completed":
                raise RuntimeError(result.error_message or "Preference conversation did not finish within two turns")
        output = PreferenceConversationOutput(proposal=result.result, question=question,
            known_cost_microdollars=sum(item.cost_microdollars or 0 for item in usage.entries),
            accounting_complete=not usage.incomplete, requests=len(usage.entries))
        observed.append(output.model_dump())
        return output

    report = evaluate_dataset(load_preference_conversation_dataset, execute, name="evals.job_preference_conversation",
        max_concurrency=1, metadata={"model": settings.chat_model, "fallback": settings.generative_fallback_model,
            "cases": 3, "max_turns_per_case": 2}, version=JOB_PREFERENCE_CONVERSATION_PROMPT_VERSION)
    print(json.dumps({"outputs": observed, "known_cost_microdollars": sum(item["known_cost_microdollars"] for item in observed)}, indent=2))
    required_scores = ("clarification_route", "stated_preferences_and_priorities", "unsupported_preferences_absent")
    if not report.cases or report.failures or any(case.evaluator_failures or
        any(case.scores.get(key) is None or case.scores[key].value != 1.0 for key in required_scores)
        for case in report.cases):
        raise RuntimeError("Preference conversation evaluation had execution, evaluator or deterministic quality failures")
    return report


if __name__ == "__main__":
    run_preference_conversation_evals()
