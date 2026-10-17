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

## Rollout Risks and Other Risks

- Smaller chunks add requests and may lose context; overlap and live comparisons measure
  the tradeoff rather than assuming improved detection. Report results on synthetic cases
  as limited evidence, not a guarantee for all inputs.
- Input-level screening no longer asks Jev to evaluate combined inputs. Trusted builders
  must cover every untrusted source; exact rendered-prompt binding and history tests guard
  against accidentally skipping new inputs.
- Screening plus generation must fit the worker visibility deadline. Bound the entire
  execution and retain charges when a late chunk or provider request fails.
- During migration retain the old guard for unmigrated callers. New guidance and code
  must agree before final verification.

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
- Phase: implementation, verification, and blind reviews complete; PR/human-QA handoff next.
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
- Planning commit: `8bcedd2`; integration base: `8bcedd2`.
- Integration: `work/upload-resume-double-calls-jev`, checkout `.worktrees/jev-integration`.
- Ticket 01 assigned to an isolated worker on
  `work/upload-resume-double-calls-jev-01-resume-screening`, checkout `.worktrees/jev-01`.
- Integrated code commits: 01 `783a759`, 02 `036e6c8`, shared library helper `83b8fdd`,
  05 `ee1df6b`, 03 `aa20394`, 04 `77a5fed`. Worker worktrees jev-01 through jev-05
  remain available. Integration after all migrations: 463 passed, 9 deselected offline.
- Ticket 06 shared guard cleanup: worker resume_foundation in `.worktrees/jev-06`;
  live comparison runner: worker gap_inputs in `.worktrees/jev-evals`; both base `77a5fed`.
- Interview TDD: four new actual-provider-boundary regressions failed on original behavior,
  then passed; final interview worker suite 444 passed, 9 deselected. Integrated interview
  focused suite 70 passed. Integrated job focused suite 23 passed; gap focused suite 21 passed.
- Tailoring's initial missing-keyword failure was test setup, not a valid red. The worker
  later ran the handler request-count regression on baseline code (failed: 2 requests vs
  10 required input checks), then verified current behavior green. Full worker suite 442
  passed, 9 deselected; integrated all-flow suite above is the release checkpoint.
- Planning checkout: master, initially clean. Integration base/head and branches pending.
- Verification baseline: offline pytest with a dummy SDK key and network disabled:
  424 passed, 9 deselected. Initial run without dummy key had SDK initialization errors
  (79 failed, 345 passed); those were setup errors, not behavior failures.
- Baseline ruff has four pre-existing errors in conversation_logging/__init__.py and
  tests/test_conversation_logging_reliability.py (BLE001 twice, I001, SIM117). Preserve
  unrelated code and distinguish these from new lint findings.
- Environment: WSL requires sandbox escalation; approved WSL commands work. WSL lacks
  rg, so inspection used grep/find.
- Ticket 06 integrated shared guard `198eb34` and comparison runner `651bd51`.
  Selected configuration/code candidate: `4c8879a45c11bc384413a2c03a8c0985eb027353`.
- Final default: 4,000 characters, 300 overlap. Both initial and repeated live comparisons
  passed all 42 assessments (14 documents x 3 settings), with zero misses, false positives,
  or provider errors. Calls: 48 for 2,000; 25 for 4,000; 14 whole. Whole was faster;
  no claim that chunking improved detection. See docs/evals/jev-screening-20261017/report.md.
- Final selected-default offline suite: 481 passed, 9 deselected. Full lint unchanged:
  four baseline findings; changed Python files pass. Final full-diff whitespace checked.
- Both existing live Jev suites passed, then passed again with explicit 4,000 setting.
  All seven affected generative eval runners exited 0. Non-perfect quality scores and
  telemetry warnings are recorded in the verification report; no unrelated tuning performed.
- Acceptance audit: all eight criteria checked against integrated source and provider-boundary
  tests. Full input coverage includes saved/retrieved/manual/imported/job/question inputs;
  current-execution reuse, fresh executions, chunks, failure/omission behavior, masking,
  usage and no persisted bypass are covered. Human browser QA remains outstanding.
- Blind correctness and design reviews independently reviewed base
  `8bcedd255d1ad5ac4427a33389814347b37a3e7d` through candidate
  `4c8879a45c11bc384413a2c03a8c0985eb027353`: no actionable findings.
  Both ran full offline suite: 481 passed, 9 excluded. Correctness focused 73 passed;
  design changed-file lint passed and identified the extra EOF blank line, now removed.
- Post-review changes are editorial only: test EOF whitespace, guard documentation wording,
  final verification and workflow records. No behavior/interface/test coverage changes;
  full review repeat is unnecessary for these changes.
- PR link pending creation. Do not merge, deploy, or remove the Kanban item; human QA
  and explicit acceptance are still required.
