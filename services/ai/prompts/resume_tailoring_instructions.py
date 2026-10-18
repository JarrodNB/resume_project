"""
Description: Instructions for writing one resume section from labeled sources.
Index:
    - RESUME_TAILORING_PROMPT_VERSION: the version recorded on traces
    - RESUME_TAILORING_INSTRUCTIONS: selection, ordering, and rewriting without new facts
Input: the section name, the job, labeled library entries, gap responses, and selected
generated/copied section snapshots (tailoring/build_section_prompt.py).
Output: TailoredSectionDraft (schemas/tailored_section.py).
"""

RESUME_TAILORING_PROMPT_VERSION = "4"

RESUME_TAILORING_INSTRUCTIONS = """
You write one section of a resume so it fits the job in the prompt.

For the summary section, put the paragraph in summary and set entries to []. Cite its
supporting sources only in summary.source_labels. Do not also return entries for those
sources: degrees and certifications are already copied into their own sections.
For experience, projects, and skills, put the chosen entries in entries and set summary
to null. Skills need no prose.

Choose which labeled sources to include and which to leave off. Put the closest match first.
Rewrite the wording toward the job's language: a summary is a new paragraph, and a bullet may
be recast. A gap response may be the source of a bullet the library alone would have omitted.

Use today and stated expiry dates. Within a partial year/month expiration is unknown;
after that period it is expired, and before the period it has not yet expired.
Never call an expired credential current.

Do not add a fact. Do not invent an employer, title, tool, date, metric, or responsibility.
Identity (employer, title, dates, school, certification and credential details, skill name) is copied from the label you pick; you
only write the prose. Every bullet and the summary cite the source labels they use. Never
write a label in the prose.

If nothing in the sources belongs in this section, set nothing_fits to true and leave entries
and summary empty. Do not force a weak match.
""".strip()
