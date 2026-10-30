# AGENTS.md — services/ai/tailoring

## Purpose

Code around the resume-tailoring agent: section order, labeled sources, the
prompt, the output-shape check, and the resume JSON the model does not get to invent.

## Contents

- `section_catalog.py` — section order (contact, then summary, experience, projects,
  education, certifications, skills) and entry label prefixes
- `tailor_resume_input.py` — the task input: contact snapshot, gap analysis, and gap responses
- `labeled_sources.py` — short labels for the complete library snapshot, gap responses, and selected draft snapshots.
  Text and saved-field provenance are built together; preparation passes that provenance
  to screening without looking entries up again. Tailoring does not retrieve or rank library rows.
- `build_section_prompt.py` — the user prompt for one written section
- `format_gap_analysis.py` — readable overview and every saved requirement assessment
- `check_section_output.py` — checks usable section shape and known source labels;
  it does not judge prose claims or replace model wording with library text
- `materialize_section.py` — copies identity (employer, title, dates, skill name) from the
  library and keeps the model's prose; also copies education and certifications exactly
- `generate_resume_draft.py` — prepares shared evidence, overlaps at most three independent
  writers, then writes the summary from selected screened source labels and assembles an ordered draft

## Local Rules

- Contact, education, and certifications are copied with no model call. Original credential
  descriptions and date precision remain intact. The summary uses their screened library
  source labels rather than screening copied sections again.
- A failed writer or deadline cancels and awaits outstanding requests before returning to
  the worker. No partial draft is published. Empty sections skip generation; nothing-fits
  sections are omitted with an explanation.
- The checker gives one repair chance for unusable structure or unknown labels.
  It accepts empty citation lists and does not inspect prose claims. The user
  reviews and edits generated wording before saving.
- Reuse saved field checks for each labeled library source and the job context; screen
  unchecked used fields once per execution and report successful approvals. Gap responses
  carry typed saved snapshots; reuse requirement/body approvals, group pending fields and
  report every saved ID with exact fingerprints even for equal text. Legacy no-ID snapshots
  stay unchecked without persistence. Keep full-source/group limits for approved inputs;
  screen job, library and gap answers together in one `screen_records` call. A blocked
  batch stops the workflow because the job is required. No partial receipts are recorded. The completed worker-produced gap analysis is validated, included in full,
  and trusted for this execution without another classifier call. The job must pass
  before section prompts use it. Bind the exact rendered prompt to those approvals; direct
  unknown writer prompts retain the capability guard.

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.

Credential dates retain `year`, `month`, or `day` precision. Exact expiration within a partial expiry period is unknown; after the period it is
definitely expired. `schemas/certification_dates.py` centralizes
formatting and expiry boundaries; tailoring prompts accept an injectable `today`.
