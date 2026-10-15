# AGENTS.md — services/ai/tailoring

## Purpose

Code around the resume-tailoring agent: section order, retrieval, labeled sources, the
prompt, the faithfulness check, and the resume JSON the model does not get to invent.

## Contents

- `section_catalog.py` — section order (contact, then summary, experience, projects,
  education, certifications, skills) and entry label prefixes
- `tailor_resume_input.py` — the task input: contact snapshot, gap analysis, gap responses,
  approved sections, and the pending user action
- `retrieve_for_section.py` — embeds that section's job requirements and hybrid-searches
  `library_embeddings` with explicitly selected library types; no matches means the whole library
- `labeled_sources.py` — short labels for retrieved entries, gap responses, and approved sections.
  Projects, education, certifications, and skills are labeled even when retrieval returned other rows
- `build_section_prompt.py` — the user prompt for one written section
- `check_section_faithfulness.py` — rejects claims the cited sources don't support. Does not
  replace the rewrite with the original library text
- `materialize_section.py` — copies identity (employer, title, dates, skill name) from the
  library and keeps the model's prose

## Local Rules

- Contact is copied in the handler with no model call.
- The checker never substitutes library text for a rejected rewrite.
- Gap-response bodies are screened before they are labeled; resume-copied entries are not.

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.

Credential dates retain `year`, `month`, or `day` precision. Exact expiration within a partial expiry period is unknown; after the period it is
definitely expired. `schemas/certification_dates.py` centralizes
formatting and expiry boundaries; tailoring prompts accept an injectable `today`.
