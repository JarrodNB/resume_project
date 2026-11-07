"""Generate from current owned job text and saved questions without classification."""
from hashlib import sha256

from pydantic import ValidationError

from agents.study_guide_agent import generate_study_guide
from llm.run_generative_agent import GenerativeOutputInvalid
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
    # Only owned successful batches supply generated variety guidance.
    previous = "\n".join(f"{number}. {question}" for number, question in enumerate(sources.previous_questions, 1))
    prompt = ("Create study material for this job description (source data):\n\n"
              + source_block("job_description", sources.description))
    if previous:
        prompt += ("\n\nPrevious saved study questions (avoid these questions and closely repeated concepts):\n"
                   + source_block("previous_study_questions", previous))
    try:
        guide = generate_study_guide(prompt, settings)
    except GenerativeOutputInvalid:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="The AI could not produce a valid study guide. Try again.")
    if isinstance(guide, StudyGuideUnavailable):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            result={"failure_code": "insufficient_description"}, error_message=guide.cannot_generate_reason)
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"study_guide": guide.model_dump(mode="json"),
                "source_description_fingerprint": sha256(sources.description.encode()).hexdigest()})
