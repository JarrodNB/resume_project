"""Render saved role and accepted question dialogue as readable model source blocks.

The caller chooses and authorizes these records. This renderer preserves wording and
ordering without JSON, screening, storage access, or model calls.
"""
from model_inputs.blocks import source_block


def saved_feedback_sources(claim):
    role = claim.role
    role_text = "Role: " + role.title
    for label, items in [("Responsibilities", role.responsibilities), ("Requirements", role.requirements)]:
        if items:
            role_text += "\n" + label + ":\n" + "\n".join("- " + item for item in items)
    sources = [source_block("interview_role", role_text)]
    for question in claim.questions:
        lines = [f"Core question ID: {question.question_id}", "Question: " + question.question]
        lines.extend(("Accepted answer: " if item.kind == "answer" else "Interviewer follow-up: ") + item.content
                     for item in question.dialogue)
        sources.append(source_block("question_dialogue", "\n".join(lines)))
    return sources
