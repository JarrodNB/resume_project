"""
Description: Dispatches a task message to the handler for its task_type.
Index:
    - TASK_HANDLERS: task_type -> handler function
    - handle_ai_task: runs one task and returns its result
"""

from collections.abc import Callable

from worker.analyze_gaps_handler import handle_analyze_gaps_task
from worker.interview_clarification_handler import handle_interview_clarification_task
from worker.interview_feedback_handler import handle_interview_feedback_task
from worker.interview_questions_handler import handle_interview_questions_task
from worker.interview_references_handler import handle_interview_references_task
from worker.interview_session_feedback_handler import handle_interview_session_feedback_task
from worker.job_preference_conversation_handler import handle_job_preference_conversation_task
from worker.library_edit_handler import handle_library_edit_task
from worker.library_review_handler import handle_library_review_task
from worker.parse_job_posting_handler import handle_parse_job_posting_task
from worker.parse_resume_handler import handle_parse_resume_task
from worker.queue_messages import AiResultMessage, AiTaskMessage, TaskType
from worker.rerank_job_listings_handler import handle_rerank_job_listings_task
from worker.scrape_job_handler import handle_scrape_job_task
from worker.study_guide_handler import handle_study_guide_task
from worker.summary_generation_handler import handle_summary_generation_task
from worker.tailor_resume_handler import handle_tailor_resume_task
from worker.task_dependencies import TaskDependencies

TaskHandler = Callable[[AiTaskMessage, TaskDependencies], AiResultMessage]

TASK_HANDLERS: dict[TaskType, TaskHandler] = {
    "generate_summary": handle_summary_generation_task,
    "rerank_job_listings": handle_rerank_job_listings_task,
    "generate_study_guide": handle_study_guide_task,
    "elicit_job_preferences": handle_job_preference_conversation_task,
    "improve_library_entry": handle_library_edit_task,
    "review_library_section": handle_library_review_task,
    "interview_session_feedback": handle_interview_session_feedback_task,
    "interview_clarification": handle_interview_clarification_task,
    "interview_references": handle_interview_references_task,
    "review_interview_answer": handle_interview_feedback_task,
    "generate_interview_questions": handle_interview_questions_task,
    "regenerate_interview_question": handle_interview_questions_task,
    "parse_resume": handle_parse_resume_task,
    "scrape_job": handle_scrape_job_task,
    "parse_job_posting": handle_parse_job_posting_task,
    "analyze_gaps": handle_analyze_gaps_task,
    "tailor_resume": handle_tailor_resume_task,
}


def handle_ai_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """Runs one task. Handlers must be safe to run twice, because SQS can redeliver a task."""
    handler = TASK_HANDLERS.get(task.task_type)
    if handler is None:
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message=f"Task type {task.task_type} is not supported yet",
        )
    return handler(task, dependencies)
