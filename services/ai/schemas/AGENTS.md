# AGENTS.md — services/ai/schemas

## Purpose

Pydantic models for structured LLM outputs (agent `output_type`s). They are also the shape of
the `result` sent to Rails, so changes must be mirrored there.

## Contents

- `parsed_resume.py` — `ParsedResume` and its parts (including `ParsedCertification`); mirrors the Rails career library and is
  imported by `ResumeImports::ImportParsedResumeService`
- `parsed_job_posting.py` — `ParsedJobPosting`, the parse agent's output (title, company, requirements, responsibilities, nice-to-haves; not sent to Rails)
- `scraped_job_posting.py` — `ScrapedJobPosting`, the `scrape_job` and `parse_job_posting` result
  (`result["scraped_job"]`); Rails turns it into a Job in
  `Jobs::CreateJobFromScrapedPostingService`
- `sorted_requirement_bullets.py` — `SortedRequirementBullets`, the job requirements sorting
  agent's output (1-based bullet numbers for requirements, responsibilities, and nice-to-haves)
- `gap_analysis_context.py` — `GapAnalysisContext` (job + `CareerLibrary`, including library facts),
  read from the database by `database/career_library_reader.py`; the gap analysis input, not an
  LLM output
- `library_search_match.py` — `LibrarySearchMatch` (source type and id, embedded text, cosine
  distance, fusion score), returned by `database/library_embedding_search.py`; not an LLM output
- `user_text_screen.py` — `UserTextScreen`: `prompt_injection` and `harmful_request`, each a
  bool with `BoolCriteria` (one question). Code applies the yes-confidence threshold
- `tailored_section.py` — `TailoredSectionDraft` (the writer output: `nothing_fits`, chosen
  entries, cited prose). Identity fields are copied by code, not emitted by the model
- `gap_analysis.py` — `GapAnalysis` (agent output: verdicts citing short labels) and
  `GapAnalysisResult`, the `analyze_gaps` result (`result["gap_analysis"]`) with evidence text
  copied from the library (kind `fact` is a library fact); mirrored by
  `apps/web/src/features/gap-analysis/parseGapAnalysisResult.ts`

## Local Rules

- Give fields `description`s when the model needs guidance; they are sent to the LLM.
- Optional fields default to `None` / empty lists so "not stated" never forces invention.

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.
