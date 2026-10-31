"""Generate from current owned job text and saved questions without classification."""
from hashlib import sha256

from pydantic import ValidationError
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

from agents.study_guide_agent import generate_study_guide
from llm.model_prices import build_model_usage, reported_model_name
from model_inputs.blocks import source_block
from schemas.study_guide import StudyGuideInput, StudyGuideUnavailable
from worker.queue_messages import AiResultMessage


def handle_study_guide_task(task, dependencies):
    """Read sources by durable task identity; ignore retained legacy source copies."""
    try:
        sources = dependencies.read_study_guide_sources(task)
        if sources is None:
            return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
                error_message="This study guide is no longer available. Start a new generation.")
        sources = StudyGuideInput.model_validate(sources)
    except ValidationError:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="Add a usable job description of at most 20,000 characters and try again.")
    if not sources.description.strip():
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="Add a job description before generating a study guide.")
    settings = dependencies.settings
    usage = []
    # Only owned successful batches supply generated variety guidance.
    previous = "\n".join(f"{number}. {question}" for number, question in enumerate(sources.previous_questions, 1))
    prompt = ("Create study material for this job description (source data):\n\n"
              + source_block("job_description", sources.description))
    if previous:
        prompt += ("\n\nPrevious saved study questions (avoid these questions and closely repeated concepts):\n"
                   + source_block("previous_study_questions", previous))
    try:
        with capture_run_messages() as messages:
            run = generate_study_guide(prompt, settings)
    except UnexpectedModelBehavior:
        by_model = {}
        for message in messages:
            if isinstance(message, ModelResponse):
                model = reported_model_name(message.model_name or settings.study_guide_model, settings.study_guide_model)
                by_model.setdefault(model, RunUsage()).incr(message.usage)
        usage.extend(build_model_usage(model, tokens) for model, tokens in by_model.items())
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="The AI could not produce a valid study guide. Try again.")
    model = reported_model_name(run.response.model_name or settings.study_guide_model, settings.study_guide_model)
    if isinstance(run.output, StudyGuideUnavailable):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            result={"failure_code": "insufficient_description"}, error_message=run.output.cannot_generate_reason,
            usage=[*usage, build_model_usage(model, run.usage)])
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"study_guide": run.output.model_dump(mode="json"),
                "source_description_fingerprint": sha256(sources.description.encode()).hexdigest()},
        usage=[*usage, build_model_usage(model, run.usage)])
