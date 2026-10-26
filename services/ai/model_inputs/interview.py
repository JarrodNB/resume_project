"""Build interview prompts from screened evidence and resolve question evidence IDs."""

from model_inputs.interview_evidence import (
    format_interview_career_evidence,
    interview_data_boundary,
    interview_question_evidence,
)
from schemas.gap_analysis_context import CareerLibrary


def format_interview_question_prompt(library: CareerLibrary, excluded, count: int, set_type: str) -> str:
    """Show relevant career text with short labels; preserve source wording for quotes."""
    return format_interview_question_input(library, excluded, count, set_type)[0]


def format_interview_question_input(library: CareerLibrary, excluded, count: int, set_type: str):
    """Build the prompt and exact source mapping behind its temporary evidence IDs."""
    # A fresh marker outside every source prevents a pasted closing line from ending its own data block.
    evidence_text, evidence_by_id = interview_question_evidence(library)
    source_text = evidence_text + "\n" + "\n".join(excluded)
    marker = interview_data_boundary(source_text)
    lines = [f"Generate {count} {set_type} questions.", "Career evidence:", marker, evidence_text, marker]
    if excluded:
        lines.extend(["Excluded questions:", marker])
        for index, question in enumerate(excluded, 1):
            lines.append(f"Question {index}: {question}")
        lines.append(marker)
    return "\n".join(lines), evidence_by_id


def format_feedback_prompt(set_type, question, answer, library):
    """Give the model readable screened facts while preserving each source's exact wording."""
    evidence_text = format_interview_career_evidence(library)
    boundary = interview_data_boundary(f"{question}\n{answer}\n{evidence_text}")
    return (f"Set type: {set_type}\n\n{boundary}\nQuestion:\n{question}\n{boundary}"
            f"\nAnswer:\n{answer}\n{boundary}\nCareer evidence:\n{evidence_text}\n{boundary}")
