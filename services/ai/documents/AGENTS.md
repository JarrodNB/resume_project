# AGENTS.md — services/ai/documents

## Purpose

Turning uploaded files into text for the agents, and checking what the agents extracted
against that text. No LLM calls here.

## Contents

- `experience_source.py` — request-local experience passage eligibility, source-ID annotation,
  validated model selections, and reconstruction of exact highlights in source order
- `extract_document_text.py` — PDF (pypdf) and DOCX (python-docx, including table cells) to
  text; raises `UnsupportedDocumentError` for other types or files with no text layer, and
  `DocumentTooLongError` when the PDF has more than 30 pages or the text is over 80,000 characters
- `enforce_source_faithfulness.py` — runtime guard for "extract, never rewrite": removes
  highlights and skills not found in the resume text, warns (without removing) about
  unmatched company, title, project, institution, and certification names
- `text_matching.py` — whitespace/case/bullet-insensitive matching helpers, shared with the
  evals

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.
