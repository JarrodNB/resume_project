"""Screen the frozen description and return a guide without reading career data or writing domain data."""
from pydantic import ValidationError
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

from agents.study_guide_agent import generate_study_guide
from model_inputs.blocks import source_block
from schemas.study_guide import StudyGuideInput
from screening.screen_user_text import screen_user_text
from screening.session import bind_screened_prompt, within_screening_session
from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import AiResultMessage


@within_screening_session
def handle_study_guide_task(task, dependencies):
    """Use only the enqueue snapshot; existing saved-job field checks do not cover this description."""
    try:
        snapshot = StudyGuideInput.model_validate(task.input)
    except ValidationError:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="Add a usable job description of at most 20,000 characters and try again.")
    if not snapshot.description.strip():
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="Add a job description before generating a study guide.")
    settings = dependencies.settings
    screen = screen_user_text(snapshot.description, model=settings.user_text_screen_model,
                              timeout_seconds=settings.llm_run_timeout_seconds)
    usage = list(screen.model_usages)
    if not screen.allowed:
        unavailable = screen.unchecked
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            result={"failure_code": "screening_unavailable" if unavailable else "input_rejected"},
            error_message=("Screening is unavailable. Try generating the study guide again later." if unavailable else
                           "This job description could not be used safely. Edit it and try again."))
    prompt = bind_screened_prompt([snapshot.description],
        lambda sources: "Create study material for this job description (source data):\n\n" + source_block("job_description", sources[0]))
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
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"study_guide": run.output.model_dump(mode="json")},
        usage=[*usage, build_model_usage(model, run.usage)])
