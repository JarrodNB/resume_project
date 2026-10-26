---
name: add-ai-workflow
description: Add a Careergrind queued AI capability across Rails ownership and enqueueing, Python execution, result application, GraphQL, and React. Use for new asynchronous AI workflows or substantive lifecycle extensions; ordinary prompt changes use change-ai-behavior, and spoken interview execution follows its separate HTTP architecture.
---

# Add an AI workflow

Deliver a narrow user-visible capability through the existing asynchronous task lifecycle.
Follow applicable `AGENTS.md` files, [execution environment guidance](../cloud-runtime.md),
and [architecture](../../../docs/architecture.md). This skill does not require invoking
the full orchestrator process or add approval gates beyond the user's authorized scope.

## Set the contract

- State the user action, allowed source data, generated result, where it is saved or reviewed,
  progress/failure behavior, and what retry means. Resolve material ambiguity before depending
  on it. Reuse a nearby workflow that shares these responsibilities, not merely similar names.
- Read [AI task contracts](../../../docs/architecture/ai-tasks.md) and
  [AI safety and usage](../../../docs/architecture/ai-safety-and-usage.md). Choose the smallest
  input/output contract, including ownership and stale-source rules. Distinguish frozen enqueue
  snapshots from worker reads of current data; do not silently switch between them.
- Keep Rails authoritative for domain writes and the Python database role read-only. If a new
  read is necessary, use the established owner-scoped reader and review its least-privilege grants.
  Spoken interview preparation/dialogue/speech use the existing
  [claimed-operation HTTP boundary](../../../docs/architecture/interview-sessions.md);
  do not create a second runtime or extend that exception to ordinary queued features.

## Implement the necessary layers

- Rails: authorize through `current_user`, keep mutations thin, and put business logic in
  domain services. Reuse shared task enqueueing and allowance checks; prepare owned snapshots
  under the owner lock and publish after commit. Preserve a useful failure if publication fails.
- Register the task type consistently in Rails and Python message validation/dispatch. Use
  Pydantic models for inputs and structured results. Handlers take `(task, dependencies)` and
  return `AiResultMessage`; they do not persist domain data directly.
- Use [change-ai-behavior](../change-ai-behavior/SKILL.md) for source selection, readable input
  rendering, screening provenance, grounded output, agent configuration, privacy, and prompt
  versions. Reuse worker accounting, deadlines, limits, and retry classification; do not create
  a second billing or queue orchestration mechanism.
- Rails result application must validate the output before domain writes and acquire the
  owner lock before task/domain locks. Duplicate deliveries keep the accepted outcome;
  stale/deleted/changed sources cannot overwrite newer work. Preserve late independently
  deduplicated usage even when the task is terminal. Use shared task updates for durable outcomes.
- If follow-up questions are needed, use the existing deferred-tool protocol with Rails-owned
  history and linked tasks. The browser supplies new answers and owned IDs, never trusted
  saved agent history. Do not add human-input pauses to workflows that do not need them.
- React: place operations and data hooks with the feature, use authorized GraphQL subscriptions
  for progress rather than polling, and show pending, success, rejection, failure, and supported
  retry states. Integrate task outcome labels/destinations and reconnect recovery when applicable;
  keep generated content and private errors out of notification payloads.
- Keep live transport and outcome publication at their established post-transaction boundaries.
  Trigger domain embedding updates through existing jobs when accepted library text changes.

## Verify the lifecycle

- Exercise observable behavior with focused Rails, Python, and component tests where affected.
  Cover success, ownership denial, invalid output, duplicate delivery, stale results, and
  relevant rejection/failure/retry paths. Include accounting replay and late usage when lifecycle
  code changes. Use synthetic fixtures and fake providers for offline checks.
- Add the relevant quality dataset/runner through
  [evaluate-ai-quality](../evaluate-ai-quality/SKILL.md); deterministic lifecycle tests do not
  establish model quality. Follow its authorization and reporting scope for paid runs.
- Follow [testing guidance](../../../docs/testing.md): dump the Rails GraphQL schema before
  frontend codegen and commit generated artifacts together when contracts change. Use generators,
  not hand edits. Restart only affected authorized development consumers as needed for live checks;
  Rails result workers do not reload Ruby code automatically.
- Update affected architecture/contracts and scoped guidance. Report delivered behavior,
  actual checks/evals, unmeasured quality, and any runtime or manual-QA limits.
