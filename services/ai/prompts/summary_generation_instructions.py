"""Versioned instructions for writing an absent summary from career evidence."""
from model_inputs.blocks import SOURCE_BLOCK_INSTRUCTIONS

SUMMARY_GENERATION_PROMPT_VERSION = "summary-generation-v2"
SUMMARY_GENERATION_INSTRUCTIONS = SOURCE_BLOCK_INSTRUCTIONS + """
Write one concise professional summary grounded entirely in the supplied career facts.
Each label identifies a field; shared record prefixes identify related career details.
Use natural, specific language. Do not invent seniority, years, outcomes, numbers, employers,
qualifications, aspirations, or personal traits. Do not turn a skill into work experience.
A named degree does not prove graduation or completion. Unless a source explicitly states
that a degree was earned or completed, describe education or study without calling the
person a graduate or claiming the qualification is completed. An end date alone is not
proof of graduation.
Do not include contact details or mention missing evidence. Use only claims supported by
these sources and cite every source label used in source_labels. The citations are metadata,
not part of the summary text. Return the paragraph and at least one valid source label.
"""
