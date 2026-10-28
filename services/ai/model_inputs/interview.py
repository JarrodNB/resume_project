"""Build readable interview inputs from career evidence selected by callers.

Question text, citation IDs, and exact quote coverage come from one evidence projection.
Rendering is deterministic and does not screen sources or approve a model call.
"""

from collections.abc import Sequence

from model_inputs.interview_evidence import (
    format_interview_career_evidence,
    interview_data_boundary,
    interview_question_evidence,
)
from schemas.gap_analysis_context import CareerLibrary
from schemas.interview_questions import InterviewQuestionContext, InterviewSetType


def build_interview_question_context(
    library: CareerLibrary, excluded: Sequence[str], count: int, set_type: InterviewSetType,
    *, recent_questions: Sequence[str] = (),
) -> InterviewQuestionContext:
    """Keep displayed evidence and its citation rules together for workers and evals.

    Only saved strings assigned an evidence ID are eligible quotes. Formatted dates,
    saved career context requirement context, exclusions, and recent practice are not evidence.
    """
    # A fresh marker outside every source prevents a pasted closing line from ending its own data block.
    evidence_text, evidence_by_id = interview_question_evidence(library)
    source_text = evidence_text + "\n" + "\n".join([*excluded, *recent_questions])
    marker = interview_data_boundary(source_text)
    lines = [f"Generate {count} {set_type} questions.", "Career evidence:", marker, evidence_text, marker]
    if excluded:
        lines.extend(["Excluded questions:", marker])
        for index, question in enumerate(excluded, 1):
            lines.append(f"Question {index}: {question}")
        lines.append(marker)
    if recent_questions:
        lines.extend(["Recent practice questions (variety guidance, not exclusions or career evidence):", marker])
        for index, question in enumerate(recent_questions, 1):
            lines.append(f"Question {index}: {question}")
        lines.append(marker)
    return InterviewQuestionContext(
        text="\n".join(lines), library_text="\n".join(evidence_by_id.values()),
        count=count, excluded=tuple(excluded), set_type=set_type, evidence_by_id=evidence_by_id,
    )


def format_feedback_prompt(set_type, question, answer, library):
    """Give the model readable screened facts while preserving each source's exact wording."""
    evidence_text = format_interview_career_evidence(library)
    boundary = interview_data_boundary(f"{question}\n{answer}\n{evidence_text}")
    return (f"Set type: {set_type}\n\n{boundary}\nQuestion:\n{question}\n{boundary}"
            f"\nAnswer:\n{answer}\n{boundary}\nCareer evidence:\n{evidence_text}\n{boundary}")
