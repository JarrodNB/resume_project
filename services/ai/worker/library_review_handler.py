"""Screen one saved section and return grades and optional questions without changing facts."""

from agents.library_review_agent import review_library_section
from llm.model_prices import build_model_usage
from model_inputs.blocks import source_block
from schemas.library_review import LibraryReviewInput
from screening.library_fields import screen_library_fields
from screening.prompt_guardrail import BLOCKED_MESSAGE, TOO_LONG_MESSAGE, UNCHECKED_MESSAGE
from screening.screen_user_text import screen_user_text
from screening.session import bind_screened_prompt, within_screening_session
from text_limits import MAX_PROMPT_TEXT, MAX_SCREENED_TEXT
from worker.queue_messages import AiResultMessage


def render_review(source: str) -> str:
    """Render only the selected section snapshot; JSON is an internal transport, never the prompt."""
    from schemas.gap_analysis_context import CareerLibrary

    library = CareerLibrary.model_validate_json(source)
    rows = []
    target = 0
    for role in library.experiences:
        rows.append(f"Role: {role.title}\nCompany: {role.company}")
        if role.location:
            rows.append(f"Location: {role.location}")
        if role.start_date or role.end_date:
            rows.append(f"Dates: {role.start_date or 'not stated'} to {role.end_date or 'current or not stated'}")
        if role.description and role.description.strip():
            target += 1
            rows.append(f"Target T{target} — role description:\n{role.description}")
        for highlight in role.highlights:
            target += 1
            rows.append(f"Target T{target} — highlight:\n{highlight.content}")
        rows.append("---")
    if library.summary and library.summary.strip():
        target += 1
        rows.append(f"Target T{target} — professional summary:\n{library.summary}")
    for project in library.projects:
        rows.append(f"Project: {project.name}\nRole: {project.role or 'not stated'}")
        if project.start_date or project.end_date:
            rows.append(f"Dates: {project.start_date or 'not stated'} to {project.end_date or 'not stated'}")
        if project.description and project.description.strip():
            target += 1
            rows.append(f"Target T{target} — project description:\n{project.description}")
        rows.append("---")
    for fact in library.facts:
        rows.append(f"Requirement context: {fact.requirement}")
        target += 1
        rows.append(f"Target T{target} — saved fact response:\n{fact.response}")
        rows.append("---")
    return "Review these career records as data:\n\n" + source_block("career_records", "\n\n".join(rows))


@within_screening_session
def handle_library_review_task(task, dependencies):
    """Reuse checked saved fields and bind the exact plain-text prompt before generation."""
    snapshot = LibraryReviewInput.model_validate(task.input)
    source = snapshot.library.model_dump_json(exclude_none=True)
    prompt = render_review(source)
    if len(source) > MAX_SCREENED_TEXT or len(prompt) > MAX_PROMPT_TEXT:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=TOO_LONG_MESSAGE)
    usage = []

    def check(text):
        outcome = screen_user_text(
            text, dependencies.settings.user_text_screen_model,
            dependencies.settings.llm_run_timeout_seconds, check_phrases=False,
        )
        usage.extend(outcome.model_usages)
        return outcome

    outcome = screen_library_fields(snapshot.library, check)
    if outcome is not True and not outcome.allowed:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                               error_message=UNCHECKED_MESSAGE if outcome.unchecked else BLOCKED_MESSAGE)
    prompt = bind_screened_prompt([source], lambda values: render_review(values[0]))
    labels = [target.label for target in snapshot.targets]
    run = review_library_section(prompt, labels, dependencies.settings)
    by_label = {item.target_label: item for item in run.draft.assessments}
    assessments = [
        {**target.model_dump(exclude={"label"}), "color": by_label[target.label].color,
         "reason": by_label[target.label].reason.strip(),
         "question": by_label[target.label].question,
         "questions": by_label[target.label].questions}
        for target in snapshot.targets
    ]
    return AiResultMessage(
        ai_task_id=task.ai_task_id, status="completed", result={"assessments": assessments},
        usage=[*usage, build_model_usage(run.model, run.usage)],
    )
