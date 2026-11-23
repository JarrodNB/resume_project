"""Render only an approved answer; no question, library, history or previous cue."""
from model_inputs.blocks import source_block


def format_memory_anchor_prompt(answer: str) -> str:
    return "Compress each answer sentence into a recall cue, preserving sentence order.\n" + source_block("answer", answer)
