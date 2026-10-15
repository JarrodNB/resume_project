# Conversation logging
Description: Local development AI conversation transcripts and delivery plan.
Index: specification, acceptance criteria, verification, delivery state.

## Delivery state
- Source: KANBAN.md, Conversation logging.
- Phase: PR open; awaiting human review and manual QA.
- Next: PR and human manual QA. Do not merge, deploy or remove Kanban item.
- Current checkout inspected: work/vectorize-question-and-answers at 15dcb27653aa2590a49a081a5d131d015749da23.
- Integration branch: work/conversation-logging, created from master at 413d4bcc5a70d50a40614c348cdab0bff6c72c92. Worktree: /mnt/c/Users/Jarrod/.codex/worktrees/conversation-logging/resume_project. No implementation tickets or code changes.
- Requirements decisions: human replies accepted full exchanges, Markdown, automatic local-dev logging with opt-out, grouping by existing IDs, model-visible contact placeholders, retained failed runs, manual deletion, and nonfatal logging errors. Human additionally requires minimal changes to existing code and a dedicated module.
- Plan approved by human reply I approve on 2026-10-15, tied to SHA-256 a1cefdfca9b52c452f783723d81816b7b94d479676426b34461f5d9895d1b64e. Breakdown approved by human reply works for me on 2026-10-15, for the two numbered tickets presented in chat.
- Verification/reviews/PR/manual QA: not started.
- Preserve unrelated local modifications to orchestrator skill, correctness-review skill, and Devise initializer.
- Keep Kanban item until explicit human completion confirmation.

## Problem Statement
Developers need to read complete AI exchanges without navigating telemetry tools. Current tasks discard message histories and span several model calls, screening runs, retries, and tailoring sections.

## Solution
Automatically write readable local Markdown transcripts when running the Docker development environment. A saved job has one transcript for analysis and tailoring. Interview work shares a transcript per question set. Resume and job imports each have a task transcript because no saved job is available at execution.

Each file identifies its grouping ID and contains timestamped task attempts and model exchanges, including system instructions, user prompts, assistant responses, tool calls and results, structured output, validation retries, failures, and nested screening. Contact text matches what the model sees. Existing files remain until manually deleted.

## User Stories
1. As a developer, I want one file for a saved job so I can follow analysis and tailoring together.
2. As a developer, I want import and interview transcripts so I can inspect work unrelated to a saved job.
3. As a developer, I want complete model-visible exchanges so I can debug prompts and outputs.
4. As a developer, I want screening, fallback, retries, and tailoring generations labeled so I can tell calls apart.
5. As a developer, I want failed attempts retained so I can investigate failures.
6. As a developer, I want files readable from my editor without telemetry or a new UI.
7. As a developer, I want local logging enabled automatically and an opt-out.
8. As a developer, I want logging failures to leave AI execution and result delivery unchanged.
9. As a maintainer, I want logging isolated so future changes stay in one module.

## Implementation Decisions
- A dedicated conversation-logging package owns task-scoped capture, grouping, readable rendering, filesystem writes/locking, and nonfatal error handling. Keep files small and interfaces narrow.
- Use a task lifecycle scope plus a model-request observation seam. Reuse the shared concrete model adapter to capture requests after contact masking and responses before contact restoration. Accounting and logging share a location, not state or responsibilities.
- Existing handlers and agent return contracts remain unchanged. Do not refactor usage accounting, telemetry, queue delivery, or domain logic.
- Scope records user ID, grouping ID, task type/ID, attempt ID, receive count, tailoring generation where present, model, timestamps, and observable outcome.
- Group analysis/tailoring by validated job UUID; interview generation/replacement/feedback by validated question-set UUID; imports and missing/invalid grouping IDs by task UUID. Include user identity in filesystem grouping to prevent accidental mixing.
- Use a git-ignored conversation_logs directory under the bind-mounted AI source directory; files are visible on the host. Paths use validated IDs, never raw prompt text or arbitrary input strings.
- Add an explicit worker environment gate that defaults to disabled outside local development. Docker Compose selects local development. Logging defaults on only there and has a documented opt-out. A Logfire environment label alone is insufficient.
- Capture complete request histories as request snapshots and label them clearly to avoid confusing repeated history with fresh turns. Distinguish structured-output tool calls, actual function-tool calls/results, and validation retries; retain identifiers and formatted JSON arguments.
- Include returned model text and other exposed message parts; mark unsupported/binary content with readable metadata. Do not claim access to hidden model reasoning or unavailable partial network responses.
- Write request snapshots before provider execution and responses/errors when observed, so completed exchanges survive a later failed call. Use process-safe locking for whole append blocks. Attempt/request IDs allow concurrently interleaved blocks to be followed without garbled Markdown.
- Retain every actual execution, including SQS redelivery and fallback. Never deduplicate real calls by task ID. Hard termination may leave an explicitly unfinished attempt.
- No automatic retention policy. File/format errors emit a concise diagnostic and never change model results, exceptions, accounting, retries, or queue publication.
- No new database permissions, queue schema fields, dependencies unless proven necessary, or linking job imports retrospectively.
- Record resolved conversation transcript terminology in the glossary during implementation; this reversible implementation choice does not warrant an ADR.

## Testing Decisions
Test observable output through the task execution and model-request interfaces using synthetic models, fake queues, temporary directories, and existing pytest patterns. No provider/network calls or browser tests.
- Full masked request and raw response capture, system instructions, tool arguments/results, output-tool distinction, validation retries, nested screening and fallback.
- Saved-job and question-set grouping; import fallback; distinct user/task/attempt/generation identity.
- Failed calls and task outcomes; truthful unavailable partial response handling.
- Production/unset environment and local opt-out create no directory or transcript.
- Filesystem failures preserve task outcomes, retry decisions, usage messages, final result delivery, and original exceptions.
- Concurrent writers append intact blocks; later attempts retain earlier content.
- Existing contact masking, accounting, guardrail, provider, and task-processing regressions.
- TDD subagents supply red/green evidence through these interfaces.

## Acceptance Criteria
1. Default local Compose execution produces host-readable Markdown transcripts without extra setup.
2. Same saved job analysis/tailoring share a file; interview tasks share their set file; imports use separate task files.
3. Transcripts show all observable model exchange parts with readable labels and JSON, including nested screening and retry/fallback calls.
4. Requests retain model-visible placeholders and responses are captured before contact restoration.
5. Task ID, attempt, generation, model and timestamps distinguish repeated or concurrent work.
6. Successful exchanges and observed failures survive later failures; missing response data is never invented.
7. Nonlocal execution and explicit local opt-out produce no transcript artifacts.
8. Writing failure cannot fail or alter task execution, accounting, retries or result delivery.
9. Existing files survive restarts; manual deletion is the cleanup method; generated transcripts are git-ignored.
10. Most new code lives in the dedicated module; external edits are small integration/configuration/documentation changes.

## Dependencies and Verification
No feature dependencies identified. Verify implementation against master before committing to hooks.
Planned Docker commands (not yet run):
- docker compose run --rm ai pytest tests/test_conversation_logging.py
- docker compose run --rm ai pytest tests/test_process_task_message.py tests/test_task_usage_accounting.py tests/test_task_usage_providers.py tests/test_task_usage_guardrails.py tests/test_contact_mask.py tests/test_prompt_guardrail.py
- Broaden to affected tracing/integration tests when integration changes require them.
Confirm exact test names in implementation and record actual commands/results rather than treating these proposals as passed.

## Manual QA
Run local Compose, import a resume/job, analyze the saved job, and progress through tailoring sections. Inspect the local folder in an editor for grouped exchanges and readable output. Generate and review interview questions and inspect their separate set transcript. Confirm opt-out, retained logs after restart, and manual deletion. Human performs QA; automated browser QA is excluded.

## Out of Scope
Production logging, a transcript UI, telemetry replacement, retrospective job-import merging, new application relationships, embedding request logs, hidden reasoning, automatic cleanup, and modifications to business behavior.

## Further Notes
Current agents have no registered function tools, but structured outputs and retry prompts already use tool-shaped messages. Test real function-tool message rendering synthetically for compatible capture without enabling tools in production behavior.

## Approved Ticket Breakdown
1. Grouped local conversation transcripts. Blocked by: none.
   Deliver the dedicated module and minimal task/model hooks, local-only activation and opt-out, git-ignored host-visible Markdown, job/set/task grouping, model-visible full exchange rendering, and labeled task attempts/model calls. Include synthetic tool/output/retry message tests and successful task-path verification. Nonfatal file errors are part of this first usable slice.
2. Reliable transcripts across failed and concurrent work. Blocked by: 1.
   Extend the working path with retained request/error blocks, fallback/nested screening and redelivery/generation evidence, process-safe appends, unfinished-attempt handling, and failure-isolation regression tests. Complete developer usage/cleanup documentation and relevant existing regression checks.

Dependency graph: 01 -> 02. Execute serially because both touch the same module and hooks.
No standalone prefactoring: existing seams suffice. Tickets published after explicit breakdown approval.
Worktree attachment remains unavailable because Windows Git reports dubious ownership; WSL Git checkout is usable after worktree repair.

Published tickets: issues/01-grouped-transcripts.md; issues/02-reliable-transcripts.md. Both ready-for-agent, 02 blocked by 01.

Ticket 01 implemented at 90ecfe8; independent Docker verification: 46 passed. Ticket 02 released and in-progress.


## Final verification and acceptance
Implementation candidate: base 413d4bcc5a70d50a40614c348cdab0bff6c72c92, head be616565dd1e769ffda3486ab783d1fde08990c8. Both tickets implemented and integrated.
- Ticket 01 integration command: docker compose run --rm --no-deps ai pytest -q tests/test_conversation_logging.py tests/test_process_task_message.py tests/test_task_usage_accounting.py tests/test_task_usage_providers.py tests/test_task_usage_guardrails.py tests/test_contact_mask.py tests/test_prompt_guardrail.py. Result: 46 passed.
- Worker 02 checks: transcript/reliability/task/accounting/contact/guardrail/tracing integration and task results: 57 passed.
- Full offline integration command: docker compose run --rm --no-deps -e OPENAI_API_KEY=offline-test-placeholder ai pytest -q -m "not db" --tb=short. Result: 398 passed, 9 deselected, 1 Logfire configuration warning. Real requests disabled by fixtures.
- First full-suite attempt lacked provider-construction key: 79 failed, 319 passed, 9 deselected. Failures were missing-key setup; corrected with dummy value, no real key or external calls.
- git diff --check against base: passed. Worker 01 Ruff: passed.
- Acceptance 1/7/9: Compose explicit local gate, default enabled, opt-out, ignored host bind directory, retention/manual cleanup documented and tested.
- Acceptance 2/5: validated user/job/question-set/task grouping; attempt/request IDs, task type, model, generation, receive count and timestamps verified.
- Acceptance 3/4: full model message parts and request parameters, structured-output/function tools/retries and original masked request/raw response tests.
- Acceptance 6/8: pre-request append, provider errors, missing-response label, queue delivery outcomes, original exception identity, incomplete accounting, formatting/disk failures, nested fallback and redelivery tests.
- Acceptance 10: capture, grouping, rendering, file append locks and outcomes are in conversation_logging package. Existing changes limited to shared task/model seams, settings, configuration, indexes and docs. No handler, queue schema, domain permission or agent prompt changes.

## Blind reviews
Fresh isolated reviewers, no inherited conversation, identical base/head above; no planning artifacts, implementation rationale, PR discussion or commit messages provided.
- Correctness: no actionable findings. Docker subset: 33 passed. Traced capture, masking/restoration, grouping, fallback, accounting, retries and publication.
- Design: no actionable findings. Docker subset: 24 passed. Verified module locality, minimal hooks and meaningful interface/concurrency/failure tests.
- No review fixes required; no further implementation changes after reviewed head. Later delivery-state documentation changes do not affect reviewed code.
- Limitations: no live providers, browser or database integration. Human manual QA pending.

## PR/manual-QA handoff
PR: https://github.com/JarrodNB/resume_project/pull/11. Branch work/conversation-logging. Follow docs/conversation_logging.md for output location, opt-out and manual cleanup. Human QA follows the outline above. Keep Kanban item, do not merge or deploy.
