"""Render already selected and screened career facts with stable citation labels."""
from model_inputs.blocks import source_block


def render_summary_sources(labels, values):
    return "Write a short professional summary using only these career facts:\n\n" + "\n\n".join(
        f"Source {label}:\n{source_block('career_fact', text)}" for label, text in zip(labels, values, strict=True))
