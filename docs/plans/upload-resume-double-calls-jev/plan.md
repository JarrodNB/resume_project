# Screen each input once per task

## Problem Statement

Resume uploads and pasted job ads screen source text with Jev, then screen the assembled
agent prompt again. Gap analysis, tailoring, and interviews also combine selected source
checks with a final prompt check. Removing the final check alone would leave gaps for
saved library entries, job fields, and reused questions that depend on it today.

## Human Decisions

- Audit all input paths, not only resume import.
- Screen each input once per task execution. Later tasks screen reused content again.
- Large inputs may use overlapping chunks; repeated boundary text is intentional.
- Preserve omission of unsafe optional inputs. Required inputs fail the operation if
  blocked or unavailable for checking.
- Confirmed in conversation. The human approved the written plan and requested live Jev
  tests after implementation is complete.
- The human subsequently approved replacing the proposed 8,000-character default with
  a live comparison of 2,000- and 4,000-character chunks, each with 300-character overlap,
  against whole-resume screening before selecting the production chunk size.

## User Stories

- Avoid duplicate screening passes when importing a resume or creating a job.
- Check every part of a large input before generation.
- Continue using safe context when an optional input is omitted, with a warning.

## Solution

Screening owns source checks, chunking, decisions, and execution-local reuse. Assemble
prompts from approved inputs and application-owned scaffolding without another Jev pass.
An input is a cohesive source item, such as a document, pasted ad, library entry, job
context item, gap response, answer, or reused question. Inventory actual consumers to
assign every untrusted field a screening owner and required/optional policy. Do not make
every scalar field a separate request.

Retain enforcement at the agent boundary: verify coverage of untrusted inputs rather
than blindly skipping checks because a handler ran. Direct agent calls also screen their
inputs. Unknown user/tool history must be screened or rejected, never silently trusted.

## Implementation Decisions

- Use an execution-scoped screening session. Each delivery, retry, or resumed task starts
  fresh. No persisted approval or caller-controlled bypass flag.
- Reuse decisions only for identical complete input content and screening policy within
  that session. Changed text needs screening. Screening owns approval provenance;
  callers must not subtract approved strings from assembled prompts.
- Support candidate chunk sizes of 2,000 and 4,000 characters, each with 300-character
  overlap. Compare them against whole-resume screening on the same synthetic documents.
  Do not select a production default until live results are available. Whole-resume
  screening is an evaluation baseline, not an additional production screening pass.
- Cover all text left to right, with no empty trailing chunk. Blank input makes no
  request; short allowed input makes one. Stop on the first block or unavailable check.
  An input passes only when all its chunks pass.
- Preserve confidence threshold, pinned model, phrase-check policy, contact masking,
  source faithfulness, and distinct unsafe/unchecked/too-long errors. Local rejection
  can avoid a Jev request.
- Preserve existing document/page, field, and prompt limits. No truncation or larger
  accepted documents. Do not impose the source-screen 80,000-character limit on an
  aggregate context currently allowed up to the prompt limit.
- Keep checks sequential and within a bounded execution deadline. Output-validation
  retries and provider fallback reuse coverage of unchanged input.
- Account for every actual chunk request, including partial failures, through existing
  request-level task accounting. Never bill reused decisions or add handler aggregates
  to observed request usage.
- Update affected repository guidance and architecture documentation: current rules
  explicitly require independent final-prompt screening.

## Testing Decisions

Use a fake Jev provider and generative provider spy. Assert actual request content/counts,
generation suppression, warnings/errors, and usage, rather than only helper call counts.

Existing seams: `test_screen_user_text.py`, `test_prompt_guardrail.py`,
`test_guardrail_task_results.py`, `test_task_usage_guardrails.py`, and task handler tests
for parsing, gaps, tailoring, and interviews under `services/ai/tests/`. Locate and extend
resume task coverage. Add direct-agent regression coverage.

Cover chunk boundaries, overlap, complete coverage, middle/final blocks, unavailable
checks, partial usage on failure, unchanged and changed content, fresh executions,
concurrent execution isolation, direct calls, supplied history, masking, fallback, and
output-validation retries. Check imported, manual, scraped, and retrieved input coverage.

Add synthetic quality cases with localized and boundary-spanning instructions in long
career documents, plus benign long documents. Compare chunked and whole-input outcomes;
do not claim improved effectiveness without evidence.
Include ordinary one- and two-page synthetic resumes as well as unusually long documents.
Use identical labelled cases for all three configurations, with attacks near the beginning,
middle, end, and chunk boundaries. Report missed attacks, false positives, per-document
latency, request count, and available usage/cost. Provider failures are reported separately.
Choose a production candidate from measured tradeoffs; if results do not establish a
reasonable choice, record the uncertainty and discuss it rather than claiming a winner.

## Architecture Decisions

Keep screening cohesive inside the AI service. Rails remains the source of truth, and
queue contracts remain unchanged. No approvals in Rails, task messages, or global caches.
Keep agent capabilities as enforcement where useful, replacing their duplicate Jev pass
with coverage enforcement and checks of previously unseen inputs.

## Observable Acceptance Criteria

1. A short allowed resume or pasted ad makes one Jev screening request before parsing,
   with no assembled-prompt duplicate.
2. Every untrusted input reaching a generative agent is screened in this execution,
   including saved library/job/question content and direct calls.
3. Unchanged input reused in one execution is not screened again. Changed content and
   later executions are screened again. Chunk overlap is the intentional exception.
4. Large inputs receive one complete chunked pass with the configured overlap.
5. Required blocked/unchecked inputs prevent generation. Optional rejected inputs are
   omitted with warnings; no partial rejected input enters generation.
6. Existing length errors, saved-answer behavior, masking, and output validation hold.
7. Every actual screening request is counted once, including partial failures.
8. No persisted approval, caller-controlled bypass, or cross-task approval leakage.

## Dependencies and Verification

After plan and ticket approval, implement through TDD in isolated worktrees. Run focused
Docker tests per slice, followed by the full offline AI suite and lint:

```bash
docker compose run --rm ai pytest -m "not db"
docker compose run --rm ai ruff check .
docker compose run --rm ai python -m evals.run_user_text_screen_evals
docker compose run --rm ai python -m evals.run_prompt_guardrail_evals
```

Run affected generative evals when agent behavior changes, per repository guidance.
Provider evals need ignored credentials and incur charges. Record real results and
limitations; offline tests cannot establish screening quality.
The human explicitly requested the final live Jev runs. Run both existing Jev suites and
the production chunking comparison after the final implementation and offline checks;
an unavailable provider or missing credentials is a reported blocker, not a passing test.
After comparing both candidate sizes against whole resumes, set the selected production
size, rerun affected offline checks, and run final live Jev verification on that configuration.

Human QA: import short/long synthetic resumes, create pasted and URL jobs, compare gaps,
tailor a section, generate interview questions, and request feedback. Inspect screening
traces/counts, omission warnings, and saved-answer behavior. Workflow excludes agent-run
browser QA.

## Out of Scope

- Persistent approvals or reuse across task executions.
- Changes to model, confidence threshold, content categories, or storage limits.
- Separate Kanban issues about import masking and missing job company names.
- Deterministic paths whose text never enters an LLM request.
- Merge, deployment, or clearing the Kanban item without human instruction.

## Additional Notes

Code inspection confirms overlapping layers; paid provider reproduction has not run.
All seven generative agents declare the final-prompt guard. Scraped job requirement
sorting needs coverage in the audit despite differing from pasted job parsing.

## Delivery Record

- Source: Upload resume double calls Jev, in KANBAN.md.
- Phase: implementation; next action: ticket 01 in an isolated worktree.
- Plan approved in conversation on 2026-10-17, with final live Jev testing requested.
  Approved plan SHA-256 before recording approval:
  `afb4f533177bd51ff51f813550f4ce756dce5062a93eb4757cf65994076447f4`.
- Breakdown: tickets 01–06 approved in conversation on 2026-10-17.
  Approved tickets SHA-256: `e0efbb9fb28864dfad9e4ccb6da6781c65d5240079edb581754f753b0d9694de`.
- Chunk comparison amendment approved in conversation on 2026-10-17: 2,000 and 4,000
  characters with 300-character overlap versus whole resumes; select from live evidence.
  Amended plan SHA-256 before recording breakdown approval:
  `8f13db2c2748f3641b7513d48f5d5cc64763a51575a31dcd88f9eeb57f3299a0`.
- Unrelated local modification to .codex/skills/workflow/SKILL.md is preserved and excluded.
- No planning commit made or implementation started.
- Planning checkout: master, initially clean. Integration base/head and branches pending.
- Verification: read-only code inspection only; tests/evals not run.
- Environment: WSL requires sandbox escalation; approved WSL commands work. WSL lacks
  rg, so inspection used grep/find.
- Reviews and PR/manual-QA handoff pending implementation.
