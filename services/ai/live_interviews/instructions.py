"""Build the live interviewer's instructions from one interview's saved inputs.

The text combines the practice-interviewer framing, the chosen persona, difficulty and focus
areas, the fictional role or saved job, and the prepared questions in order. Every supplied
value is escaped inside a data section and the user's known name, email and phone are replaced
with placeholders, because these instructions go to the speech provider. The result is
readable prose with headings and bullets, never a JSON dump. Career references are not inputs,
so they can never reach the interviewer.
"""

from database.live_interview_inputs import LiveInterviewInputs
from interviews.conversation import ContextLimitExceeded, data_block, format_role, format_saved_job
from privacy.contact_mask import contact_scope, mask_outbound
from prompts.interview_style import live_style
from prompts.live_interviewer_instructions import JOB_UNAVAILABLE, LIVE_INTERVIEWER_INSTRUCTIONS
from text_limits import MAX_PROMPT_TEXT


def _question_plan(questions: tuple[str, ...]) -> str:
    lines = ["# Question plan", "Ask these prepared questions in this order, one at a time."]
    for number, question in enumerate(questions, 1):
        lines.append(f"## Question {number}\n{data_block('question', question)}")
    return "\n\n".join(lines)


def build_live_instructions(inputs: LiveInterviewInputs) -> str:
    """Return the full realtime-session instructions for this interview.

    Raises ContextLimitExceeded when the assembled text is too long to send.
    """
    with contact_scope(inputs.contact):
        sections = [LIVE_INTERVIEWER_INSTRUCTIONS, live_style(inputs.setup)]
        if inputs.job is not None:
            sections.append(format_saved_job({"job": inputs.job}))
        elif inputs.job_deleted:
            sections.append(JOB_UNAVAILABLE)
        elif inputs.role:
            sections.append(format_role(inputs.role))
        sections.append(_question_plan(inputs.questions))
        text = mask_outbound("\n\n".join(sections))
    if len(text) > MAX_PROMPT_TEXT:
        raise ContextLimitExceeded("Live interview instructions exceed the prompt limit")
    return text
