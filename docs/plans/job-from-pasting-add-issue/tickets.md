# Unknown-company job implementation tickets

Breakdown approved by the user in chat with "confirmed" on 2026-10-17.
Approved pre-recording SHA-256: 11a4c8c77ba3f5e01af8bdbd1749792ffb596712649bae1b4a4a1068eba3e657.
Use the approved plan.md for scope and shared acceptance criteria. Run checks in Docker
from isolated worker worktrees; follow local AGENTS.md and red-green-refactor.

## Ticket 01 — Save, edit, and use jobs with an unknown company

**What to build:** A complete saved-job path where company can be null, the UI displays
Unknown company, the user can add or clear it, and downstream AI job workflows accept it.
Deliver tolerant consumers before changing the pasted-ad producer.

**Blocked by:** None.

**Layers:** Rails migration/model/services/GraphQL, generated schema and frontend types,
jobs UI, AI job read models and downstream consumers, affected architecture guidance.

**Modularity:** Rails services own blank-company normalization; Job owns persistence
constraints. Existing UI views own the display fallback. Keep nullable job context handling
in its existing schemas and consumers; do not change career-library employer fields.
Test through services, GraphQL, task result application, React interactions, and existing
AI context/prompt seams. Do not introduce a new orchestration abstraction.

**Status:** ready-for-agent

**Acceptance Criteria:**

- [ ] jobs.company allows null; title remains required and text limits remain enforced.
- [ ] Create/update and completed pasted-import application store null for missing or blank
  company, permit adding/clearing it, and preserve named-company behavior.
- [ ] GraphQL returns a nullable company; exported schema and generated web types agree.
- [ ] Job list/detail display Unknown company; edit/manual forms allow empty company and
  send null without storing the fallback label.
- [ ] Saved null-company jobs pass affected downstream AI context, screening, gap-analysis,
  tailoring, and interview-preparation paths without company-related failure or literal
  None/null employer labels. Audit transcript labels as well.
- [ ] Duplicate task result delivery creates one job; tenant isolation remains intact.
- [ ] Guidance documents the new stored-job contract and migration/rollback ordering.

**Verification:** Intended: focused Rails service/model/GraphQL/result-application specs;
schema export and web codegen; jobs React tests, frontend types/lint; focused downstream
AI tests and AI lint/schema dependency check. Use plan.md commands and add exact test paths
after inspecting existing seams. Record behavior-level red/green evidence and all results.

**Progress:** Unassigned. Intended branch work/job-from-pasting-add-issue-01-optional-company
in its own worktree from the integration head. Starting base, commits, actual checks,
blockers, and concerns: not started. Integration and ticket records belong to coordinator.

## Ticket 02 — Import unnamed-employer ads without a validation retry

**What to build:** The pasted-ad parser returns null when the company is unstated and
completes without requesting another model response solely because company is missing.

**Blocked by:** Ticket 01 integrated and verified. Producer changes require tolerant
storage and consumers; this dependency also avoids concurrent changes to shared AI schemas.

**Layers:** AI parsing schema/prompt/agent validation, posting conversion and queue result
schema/normalization, handler errors, parse evals, affected web import guidance and docs.

**Modularity:** Preserve the existing parse-agent, source-validator, posting-converter,
and worker boundaries. Nullable company is a data contract, not an invented employer.
Use a fake provider through real agent output validation to observe request count; do not
mock away the validator in the no-retry regression test.

**Status:** ready-for-agent

**Acceptance Criteria:**

- [ ] ParsedJobPosting and the emitted scraped_job accept company null, including posting
  conversion and saved-length normalization without string-method errors.
- [ ] An otherwise valid null-company response succeeds with one generative model request.
- [ ] Prompt directs the model to return null for an unstated employer; no guessed name or
  display placeholder is substituted. Supplied names still require source evidence.
- [ ] Missing title remains invalid; title and bullet faithfulness checks stay effective.
- [ ] The handler completes a synthetic titled ad without an employer; integrated Rails
  result application saves the job with null company.
- [ ] Import guidance/errors no longer claim employer is mandatory; named-company behavior
  and existing screening/retry rules remain covered.
- [ ] Missing-company eval coverage and evaluator null handling are updated; actual offline
  checks and paid parse-eval results or execution blockers are recorded.

**Verification:** Intended: real agent fake-provider regression, posting conversion and
handler tests, parse-evaluator tests, schema dependency check, AI lint, integrated Rails
import/result-application specs, affected jobs UI tests/types/lint, and
docker compose run --rm ai python -m evals.run_job_posting_parse_evals.
Record exact red/green and broader check commands/results. Human QA follows plan.md;
no browser automation.

**Progress:** Unassigned. Intended branch work/job-from-pasting-add-issue-02-parse-unknown-company
in its own worktree from the verified Ticket 01 integration head. Starting base, commits,
actual checks, blockers, and concerns: not started. Coordinator owns integration and records.

## Integration and review handoff

After both tickets are integrated, verify every plan acceptance criterion and fix a
committed base/head snapshot. Run the workflow's two fresh blind reviews in parallel,
resolve validated findings, rerun affected checks, then prepare a PR for human QA.
Keep the Kanban item until explicit human completion confirmation. No merge or deployment.
