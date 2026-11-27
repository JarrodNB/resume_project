"""Render saved role and accepted question dialogue as readable model source blocks.

The caller chooses and authorizes these records. This renderer preserves wording and
ordering without JSON, screening, storage access, or model calls. Each candidate answer
is its own source value, so a caller can check the candidate's words separately from
the interviewer's generated text and still bind the exact rendered prompt.
"""
from dataclasses import dataclass

from model_inputs.blocks import source_block


@dataclass(frozen=True)
class FeedbackSources:
    """Ordered source values plus the trusted layout that renders them into one prompt.

    `answers` lists the candidate's own words; `interviewer` lists the saved role,
    questions and follow-ups. The layout holds only labels and counts, never source text.
    """

    values: list[str]
    answers: list[str]
    interviewer: list[str]
    _layout: list[list[str]]

    def render(self, values) -> str:
        values = iter(values)
        blocks = [source_block("interview_role", next(values))]
        for labels in self._layout:
            lines = [next(values)]
            lines.extend(label + next(values) for label in labels)
            blocks.append(source_block("question_dialogue", "\n".join(lines)))
        return "Review this completed interview:\n\n" + "\n\n".join(blocks)


def saved_feedback_sources(claim) -> FeedbackSources:
    role = claim.role
    role_text = "Role: " + role.title
    for label, items in [("Responsibilities", role.responsibilities), ("Requirements", role.requirements)]:
        if items:
            role_text += "\n" + label + ":\n" + "\n".join("- " + item for item in items)
    values, answers, interviewer, layout = [role_text], [], [role_text], []
    for question in claim.questions:
        header = f"Core question ID: {question.question_id}\nQuestion: {question.question}"
        values.append(header)
        interviewer.append(header)
        labels = []
        for item in question.dialogue:
            labels.append("Accepted answer: " if item.kind == "answer" else "Interviewer follow-up: ")
            values.append(item.content)
            (answers if item.kind == "answer" else interviewer).append(item.content)
        layout.append(labels)
    return FeedbackSources(values, answers, interviewer, layout)
