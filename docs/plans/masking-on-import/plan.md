# Masking on import

## Problem Statement

Import masking currently replaces only contact already known from the user's profile.
PII first encountered in a resume can reach screening, parsing, and telemetry unchanged.

## Human Decisions

- Mask names, email addresses, and phone numbers before external AI calls; unmask afterward.
- Start with resume imports.
- Keep masking and unmasking in their own module.

The user approved this design with “Looks good to me.”

## User Stories

- Imported contact is protected even when my profile is empty or different.
- I see original details in the completed import rather than placeholders.

## Solution

Extract text locally. Detect PERSON, EMAIL_ADDRESS, and PHONE_NUMBER locally using
Presidio Analyzer and a bundled English spaCy model. Replace detected values with typed,
reversible placeholders before safety screening or parsing. Restore structured results
before checking against the original source and returning data to Rails. Keep telemetry
masked even when responses have been restored.

Detection is probabilistic and cannot guarantee every name will be found. Validate
coverage using synthetic resumes, including international names and phone formats.

## Implementation Decisions

- Introduce `services/ai/pii/`, owning detection, overlapping spans, collision-safe
  placeholders, and recursive restoration. Expose document preparation returning masked
  text and a per-import masking session. Callers do not manage recognizers or replacements.
- Preserve exact original values and formatting. Repeated identical values get stable
  placeholders. Existing placeholder-like text must round-trip safely.
- Keep maps in task-local memory, never prompts, queues, logs, or transcripts. Do not
  share maps between users or attempts.
- Integrate with existing contact hooks so profile and detected replacements cannot
  collide. Retain known-contact protection for other task types.
- Analyze the whole extracted text before forming screening chunks. Preserve original
  input length limits and bind screening approvals to exact masked sources.
- Restore structured results before source-faithfulness checks. Fail safely if generated
  placeholders remain unresolved rather than saving them.
- Protect telemetry through span completion, including parent spans created before
  document detection and exports after the masking scope exits.
- Detector errors or missing model assets fail the import before either AI provider is
  called. Finding no entities is not itself an operational error.
- Bundle pinned dependencies and a pinned model in the AI image; no runtime model
  downloads. Check Python 3.13 compatibility and model licensing during setup.

## Testing Decisions

Use TDD at the new public interface and actual provider boundaries, following existing
contact, import, tracing, and conversation logging tests.

- Real local detector tests with synthetic names, multiple emails, international phones,
  repeated/overlapping entities, empty/different profiles, and useful facts left intact.
- Exact restoration, placeholder collisions, and isolation across tasks/users.
- Fake screening and parsing providers capture actual outbound requests, including
  retries/fallback. Both see placeholders; completed results contain original values.
- Source-faithfulness checks still retain original highlights containing PII.
- Detection failure makes zero provider calls; unreadable/oversized documents and
  screening rejection/unavailability preserve existing behavior.
- Captured telemetry/transcripts stay masked, including restored responses, exception
  paths, parent spans, and delayed export.
- Duplicate delivery remains safe; other tasks retain known-contact behavior.

Run focused offline pytest, the AI offline suite, and Ruff in Docker per
`docs/testing.md`; rebuild after dependencies change. Record exact commands and results
in tickets. If prompts or agent behavior change, run the existing parsing evals using
synthetic data and report any paid-provider execution limitations.

## Architecture Decisions

The independent PII module owns privacy behavior. The handler coordinates import steps;
provider and telemetry adapters delegate masking rather than duplicating rules. Rails
still receives restored domain data through the existing results queue. No GraphQL or
queue schema changes are expected. Update architecture guidance for the import boundary.

## Rollout Risks and Other Risks

NER can miss names or mistake employers/skills for people; phone coverage varies by
format and country. English is the initial NLP model, without promised multilingual
coverage. Check container size, startup time, and CPU cost. Detector unavailability
deliberately blocks imports. Restoration must survive structured outputs and retries;
it does not invent contact fields omitted by the parsing model.

## Observable Acceptance Criteria

1. Imported names, emails, and phones absent from the profile are masked on both providers.
2. Returned structured strings contain original detected values without generated tokens.
3. Maps are isolated between users and attempts and are never persisted or published.
4. Detected values remain masked in remote telemetry and concrete request transcripts.
5. Detector failure sends no document text to either AI provider and gives a safe error.
6. Screening, limits, source checks, accounting, and duplicate delivery retain behavior.
7. Other task types retain existing contact protection.

## Dependencies and Verification

Compatible pinned Presidio/spaCy dependencies and a bundled model are required. Verify
startup without model downloads. Manual QA: import a synthetic resume with an empty
profile, inspect restored contact/library content and masked provider captures/traces,
then repeat with different profile contact and a second user.

## Out of Scope

Detection for other task types; addresses and general URL redaction; employer, school,
and date masking; upload/storage encryption changes; guaranteed complete PII detection.
Detected names/emails/phones embedded in other text still require masking.

## Additional Notes

- [Presidio installation and NLP engines](https://microsoft.github.io/presidio/installation/)
- [Supported entities](https://microsoft.github.io/presidio/supported_entities/)

## Delivery Record

- Source: `KANBAN.md`, “Masking on import”; keep until human acceptance.
- Phase: ready for human review and QA.
- Human scope decisions: imports first; names/email/phone; reversible; separate module.
- Plan approval: user “Looks good to me,” approving the plan content with SHA-256
  `6bc3c7b02a5db56e2d253cfc4acd5b1b8f18d881318e2f7dab77399045971206`
  before this approval-record update.
- Breakdown approval: user “confirmed.” Approved tickets SHA-256:
  `0727a6fb9c83e17419c85331477ba17d553a2ccee079ea75a2109a17bc0b0085`.
- Tickets: 01 and 02 implemented. Human acceptance pending.
- Planning commit and integration base: `6722f8a1245711e62da66ae30e2cf38dcc2e415b`.
- Integration: `work/masking-on-import`, `.worktrees/masking-integration`.
- Worker 01: `work/masking-on-import-01-local-pii`, `.worktrees/masking-on-import`;
  assigned to the PII module agent at the planning base.
- Ticket 01 worker commit `83ec5c0`, integrated as `f1592c5`; 21 focused offline tests pass.
- Worker 02: `work/masking-on-import-02-import-lifecycle`,
  `.worktrees/masking-import-lifecycle`, base `6c5af29`; assigned to lifecycle agent.
- Ticket 02 integrated as `c0776e0`, follow-ups `d83e9f7` and `d33c24b`;
  prompt refinement `cfc3080`, detector refinement `5a9b563`.
- Final verification: 515 offline tests passed, 9 database tests deselected; changed-file
  Ruff and diff checks pass. Four existing full-Ruff errors reproduced in untouched master.
- Final real-provider synthetic parsing evaluation: six cases, no errors, all reported
  scores 1.0. Initial failures and resulting refinements are recorded in tickets.
- Review base: remote master `f69499bfdf3d143168ed775ca036fd8f5c93369d` (fetched and
  verified unchanged). Review candidate: this verification-record commit; see Git.
- Review round 1: base `f69499bfdf3d143168ed775ca036fd8f5c93369d`, candidate
  `9c034d2dfa95e76e7110a51be01f70af780cb1d8`. Fresh correctness reviewer reproduced P2:
  62,500 original characters expand to a 155,019-character prompt, failing the unchanged
  120,000-character generative guard after screening. Finding accepted; scoped fix and
  real-guard regression assigned in `.worktrees/masking-length-fix` at that candidate.
- Round 1 design reviewer: no actionable findings; 95 independent focused tests and
  changed-file lint passed. Correctness reviewer: 79 focused tests passed plus reproduced
  the length failure. Both read-only; four pre-existing full-Ruff findings unchanged.
- A fresh pair will review the full final diff after the behavior fix and checks.
- Length fix: worker `c7f8000`, integrated `5ac491b`. Exact covered import prompts use
  original length; unknown input/history and other tasks keep their actual-length cap.
  Five real-guard boundary tests pass (red/green for valid long import); 76 focused tests
  passed. Final full suite: 520 passed, 9 database tests deselected, one existing warning.
- Final synthetic real-provider evaluation repeated after the guard fix: six cases,
  no errors, all reported scores 1.0. Changed-file Ruff and diff checks pass.
- Review round 2: fresh reviewers, original base
  `f69499bfdf3d143168ed775ca036fd8f5c93369d` through final candidate
  `6604aa755cc98dcd342cf8c44c6a252312982ae7`. Correctness: no actionable findings;
  90 focused tests and independent full offline suite (520 passed, 9 deselected).
  Design: no actionable findings; 89 focused tests and changed-file Ruff passed.
- All plan acceptance criteria checked through source and observable tests; detector
  limitations remain documented. Only editorial delivery/PR records change after review;
  no new code review round is needed for those records.
- PR: https://github.com/JarrodNB/resume_project/pull/13 on `work/masking-on-import`.
  Reviewed code candidate `6604aa7`; later commits update delivery records only.
  Rebuild the AI development image for the bundled model before manual QA.
- Manual QA remains the plan's synthetic empty-profile,
  differing-profile, and second-user import checks; no browser QA performed.
- Baseline verification: offline Docker tests `test_task_handlers.py`,
  `test_contact_mask.py`, `test_tracing.py`, and `test_process_task_message.py`: 32 passed.
  Used existing `resume_project-ai:latest`, an explicit integration-worktree mount,
  `--network none`, and dummy `OPENAI_API_KEY=offline-test-key`. The first run without
  that dummy key had 5 provider-construction failures and 27 passes; rerun passed all.
  No paid requests or application changes were involved in the baseline.
- Preserve unrelated existing edit: `.codex/skills/workflow/SKILL.md`.
- Planning files are ignored by `/docs/plans/` in `.gitignore`; force-add only the
  approved feature artifacts when committing after breakdown approval.
