"""Read an owned saved answer and return an editable, sentence-aligned recall cue."""
from agents.interview_memory_anchor_agent import generate_interview_memory_anchor
from llm.run_generative_agent import GenerativeOutputInvalid
from model_inputs.interview_memory_anchor import format_memory_anchor_prompt
from screening.record_adapters import interview_answer_record
from screening.records import screen_records_sync
from screening.session import bind_screened_prompt, within_screening_session
from worker.interview_feedback_handler import InterviewFeedbackInput
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


@within_screening_session
def handle_interview_memory_anchor_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """No library access; exact saved answer approvals are reusable across AI operations."""
    if dependencies.read_interview_question_sources is None:
        raise RuntimeError("Interview question reader is not configured")
    sources = dependencies.read_interview_question_sources(task)
    if sources is None:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="This answer changed. Generate another memory anchor.")
    saved = InterviewFeedbackInput.model_validate(sources)
    source = saved.model_dump(mode="json")
    source["screened_fields"] = saved.screened_fields
    outcome = screen_records_sync([interview_answer_record(source, "answer_text", saved.answer_text)],
        approved_sources=[saved.answer_text]).decision
    if not outcome.allowed:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=outcome.model_usages,
            error_message="Your answer is saved. We couldn't use it to generate an anchor. Review it or try again.")
    text = bind_screened_prompt([saved.answer_text], lambda values: format_memory_anchor_prompt(values[0]))
    try:
        anchor = generate_interview_memory_anchor(text, saved.answer_text, dependencies.settings)
    except GenerativeOutputInvalid:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=outcome.model_usages,
            error_message="The AI couldn't produce a valid memory anchor. Your existing anchor is unchanged. Try again.")
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"memory_anchor": anchor.text}, usage=outcome.model_usages)
