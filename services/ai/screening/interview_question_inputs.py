"""Prepare matching question text and citation evidence from checked library sources.

The worker supplies generated question history with verified provenance. This module
keeps source layout and exact prompt binding together; rendering itself stays pure.
"""

from collections.abc import Sequence

from model_inputs.interview import build_interview_question_context
from schemas.interview_questions import InterviewQuestionContext, InterviewSetType
from screening.library_inputs import ScreenedLibrary, rebuild_library
from screening.session import bind_screened_prompt


def prepare_interview_question_context(
    selected: ScreenedLibrary, excluded: Sequence[str], count: int, set_type: InterviewSetType,
    *, recent_questions: Sequence[str] = (),
) -> InterviewQuestionContext:
    """Build all context views inside the same exact-source coverage callback.

    This does not approve sources. Coverage is granted only when library sources and
    generated history are already approved in the current screening session.
    """
    context: InterviewQuestionContext | None = None
    library_end = len(selected.fields)
    excluded_end = library_end + len(excluded)

    def render(values: Sequence[str]) -> str:
        nonlocal context
        library = rebuild_library(values[:library_end], selected.fields)
        context = build_interview_question_context(
            library, values[library_end:excluded_end], count, set_type,
            recent_questions=values[excluded_end:],
        )
        return context.text

    bind_screened_prompt([*selected.sources, *excluded, *recent_questions], render)
    # bind_screened_prompt always calls render synchronously, even without coverage.
    assert context is not None
    return context
