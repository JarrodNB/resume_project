---
name: diagnose-ai-task
description: Investigate a specific failed, stalled, duplicated, or expensive Careergrind AI task by correlating Rails state, queue delivery, worker execution, provider evidence, and live updates. Use for incident diagnosis, not standalone output-quality evaluation or a general observability audit.
---

# Diagnose an AI task

Explain the observed task outcome using evidence from the actual environment. Follow
applicable `AGENTS.md` files and [execution environment guidance](../cloud-runtime.md).
Start with read-only investigation; a request for an explanation alone does not authorize
replaying work, changing records, restarting consumers, or making provider requests.

## Identify the task and execution path

- Resolve the task ID, owning account, symptom, approximate time, checkout, and runtime.
  Inspect available context and connected telemetry before asking for missing identifiers.
  Verify container mounts/Compose project or native runtime paths so evidence comes from
  the affected environment, not another review stack.
- Read [AI task contracts](../../../docs/architecture/ai-tasks.md) for queued work. Spoken
  interviews use claimed operations over internal HTTP; use
  [interview sessions](../../../docs/architecture/interview-sessions.md) and
  [provider accounting](../../../docs/architecture/interview-provider-accounting.md) for that path.
- Record task type/status, relevant timestamps, subject/source identities, and associated
  attempts or operations. Distinguish the user's action, task, SQS delivery, execution UUID,
  agent run, and concrete provider request; these are different identities.

## Locate the first supported failure

Trace only as far as needed to distinguish the suspected stages:

| Stage | Evidence to inspect |
| --- | --- |
| Admission/enqueue | Allowance result, owned task/snapshot, publication result, configured queue endpoint |
| Delivery/execution | Correct consumers, dispatch registration, receive count, attempt markers, timeout/shutdown/retry evidence |
| Input preparation | Storage/extraction, source limits, masking, screening decisions/coverage, retrieval and prompt version |
| Provider/validation | Actual model/request identity, provider failure, validation feedback/exhaustion, explicit fallback event |
| Result application | Publication outcome, Rails result-consumer error, duplicate/stale fencing, persisted domain outcome |
| Client update | Saved task/outcome versus subscription ownership, connection/recovery cursor, notification destination |

- Use bounded task/time queries through available Logfire tools and safe application logs.
  Inspect [worker guidance](../../../services/ai/worker/AGENTS.md) for execution and retry
  ownership. Absence of a span does not establish absence of a request; flushing, sampling,
  interruption, or export failure can leave telemetry incomplete.
- Local [conversation transcripts](../../../docs/conversation_logging.md) can clarify
  provider and validation exchanges. They contain private model-visible content: inspect
  only the relevant task locally and keep raw content out of commits, PRs, and shared reports.
- Pair concurrent records by IDs, not file ordering. Repeated history in request snapshots
  is not a new user message; redelivery is not proof of a provider failure; a model-name
  change alone is not proof of fallback. Separate observations from hypotheses.

## Explain cost and recovery

- Reconcile concrete request evidence with execution accounting and Rails usage records.
  Finished tasks may receive late charges without changing their outcome. Usage-only reports
  do not establish task completion. Do not sum handler aggregates over request-level charges.
- Report known cost, unknown usage, and reservation/estimate values separately. Missing
  responses, prices, or accounting reports are not free calls. An interview estimate is not
  a provider hold, invoice charge, or bill ceiling. Do not invent zeroes or erase usage rows.
- Before an authorized retry/restart, determine whether work is already pending or accepted,
  whether its source snapshot is stale, and what replay could repeat or spend. Preserve
  submission/execution identities where the established recovery path requires them.
  Speech-only retry must not repeat accepted dialogue processing.
- Use the feature's supported recovery path and current environment policy. Do not purge
  queues, reset volumes, overwrite terminal tasks, or manually republish historical work to
  make the symptom disappear. If only diagnosis was requested, present the specific next action.

## Deliver the finding

Report the affected task/environment, concise event sequence with evidence references,
the failing stage and confidence, user-visible/domain outcome, accounting uncertainty,
and the next supported action. Say what remains unverified. For an authorized repair,
add focused regression coverage and report actual checks; use
[change-ai-behavior](../change-ai-behavior/SKILL.md) for model behavior changes and
[evaluate-ai-quality](../evaluate-ai-quality/SKILL.md) for output-quality evidence.
