---
name: observability-loop
description: Close demonstrated operational diagnostic gaps in a bounded loop of independent reviewed PRs.
---

# Observability Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping.

Choose a concrete failure or stalled operation that current telemetry cannot distinguish or trace. State the diagnostic question and show the gap. Follow established tracing ownership, correlation, and provider conventions. Add the smallest useful signal and exercise success and failure paths to demonstrate the question becomes answerable. Check bounded cardinality, volume, correlation, and redaction. Do not log credentials, raw resumes, prompts, or sensitive payloads; do not swallow exceptions or change outcomes to improve telemetry. External dashboards and alert policies require scoped authorization.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
