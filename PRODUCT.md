# Careergrind

<!-- impeccable:product-schema 1 -->

Shared product context for the web app and landing page. This records durable
product decisions; architecture and implementation details remain in the existing docs.

## Platform

web

## Users

Job seekers across roles who want to organize their career experience, prepare
applications for specific jobs, and practice interviews. No narrower audience is
currently selected.

## Product Purpose

Careergrind helps users turn their real career experience into tailored resumes
and keep their job search organized and focused. Users collaborate with AI and
review and refine its output before using it.

The project's first priority is demonstrating AI engineering quality for a
portfolio; a possible business comes second. Favor engineering quality and
showcase value over feature breadth or market positioning.

## Positioning

Careergrind combines a reusable career library, job requirement comparisons,
user-supplied evidence, resume tailoring, and interview preparation in one
workflow. It supports focused applications and user judgment rather than
mass-generated, mass-sent resumes.

## Operating Context

- Users import a PDF or DOCX resume for review or enter career details manually.
- The career library is the reusable source of career evidence; there is no
  separate base resume to keep in sync.
- Users save jobs from posting URLs or enter them manually, then track application
  stages: unapplied, applied, interviewing, rejected, and offer.
- Gap analysis compares career evidence with job requirements. Users can answer
  gaps and partial matches and choose to save those answers as career context entries.
- Users review and edit job-specific resumes and export them as PDFs.
- Interview preparation supports job-specific questions, saved answers, and feedback.

## Capabilities and Constraints

- Generated career claims must be grounded in the user's career library and gap
  responses. Do not invent experience, skills, achievements, or numbers.
- Human review is part of the workflow; AI output is a draft for the user to assess.
- AI work runs asynchronously. Interfaces need to represent work in progress,
  completion, and failure accurately.
- Career evidence belongs to the current user. Preserve user boundaries when
  displaying, retrieving, or generating content.
- The React web app and marketing landing page are separate apps. The landing
  page currently contains starter content, not approved marketing claims.
- Public-launch name availability remains an open decision in docs/mvp_plan.md.
- No product-specific accessibility standard has been confirmed yet.

## Brand Commitments

The product name is Careergrind. Keep language simple and understandable to a
college student. Describe AI capabilities accurately without promising perfect
outputs or employment outcomes.

## Evidence on Hand

- README.md describes implemented capabilities and AI engineering mechanisms.
- docs/mvp_plan.md records project priorities and the original milestone scope;
  consult current implementation for feature status.
- GLOSSARY.md records shared domain terminology.
- services/ai/evals/ contains synthetic evaluation datasets and evaluators.
  These are engineering evidence, not customer results or proof of job outcomes.
- Existing app components provide implementation evidence. Bundled starter logos
  and imagery are not approved Careergrind brand assets.
- No customer testimonials, adoption numbers, or employment outcome claims have
  been established for use in future interfaces or marketing.

## Product Principles

1. Keep the user involved in writing, reviewing, and approving career content.
2. Ground claims in real career evidence and make gaps visible.
3. Support focused applications rather than maximizing application volume.
4. Reuse career knowledge so users do not repeatedly reconstruct their history.
5. Favor demonstrable AI engineering quality over adding more features.
