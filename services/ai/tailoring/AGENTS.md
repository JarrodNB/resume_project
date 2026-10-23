# AGENTS.md — services/ai/tailoring

## Purpose

Code around the resume-tailoring agent: section order, retrieval, labeled sources, the
prompt, the faithfulness check, and the resume JSON the model does not get to invent.

## Contents

- `section_catalog.py` — section order (contact, then summary, experience, projects,
  education, certifications, skills) and entry label prefixes
- `tailor_resume_input.py` — the task input: contact snapshot, gap analysis, and gap responses
- `retrieve_for_section.py` — embeds that section's job requirements and hybrid-searches
  `library_embeddings` with explicitly selected library types; no matches means the whole library
- `labeled_sources.py` — short labels for retrieved entries, gap responses, and selected draft snapshots.
  Text and saved-field provenance are built together; preparation passes that provenance
  to screening without looking entries up again. Projects, education, certifications, and
  skills are labeled even when retrieval returned other rows
- `build_section_prompt.py` — the user prompt for one written section
- `check_section_faithfulness.py` — rejects claims the cited sources don't support. Does not
  replace the rewrite with the original library text
- `materialize_section.py` — copies identity (employer, title, dates, skill name) from the
  library and keeps the model's prose; also copies education and certifications exactly
- `generate_resume_draft.py` — prepares shared evidence, overlaps at most three independent
  writers, then writes the summary from selected content and assembles an ordered draft

## Local Rules

- Contact, education, and certifications are copied with no model call. Original credential
  descriptions and date precision remain intact. Copied text still requires screening
  before it is reused in the summary prompt.
- A failed writer or deadline cancels and awaits outstanding requests before returning to
  the worker. No partial draft is published. Empty sections skip generation; nothing-fits
  sections are omitted with an explanation.
- The checker never substitutes library text for a rejected rewrite.
- Screen each selected labeled source (including library entries, gap-response requirements
  and bodies, and selected snapshot titles/content), the job context, and optional gap summary once
  per execution. Unsafe optional sources are omitted with warnings. The job must pass
  before retrieval embeds it. Bind the exact rendered prompt to those approvals; direct
  unknown writer prompts retain the capability guard.

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.

Credential dates retain `year`, `month`, or `day` precision. Exact expiration within a partial expiry period is unknown; after the period it is
definitely expired. `schemas/certification_dates.py` centralizes
formatting and expiry boundaries; tailoring prompts accept an injectable `today`.

- Experience snapshots preserve each source employment block, its ordered roles/dates, and
  shared versus role-scoped bullets. Evidence IDs stay with generated wording; shared
  achievements never inherit a role based on title order or dates.
