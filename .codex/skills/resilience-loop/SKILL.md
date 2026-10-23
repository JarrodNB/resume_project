---
name: resilience-loop
description: Repair demonstrated failure-handling weaknesses in a bounded loop of independent reviewed PRs.
---

# Resilience Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping.

Choose one evidenced failure path: duplicate delivery, timeout, interruption, partial writes, retry exhaustion, or unavailable dependencies. Trace durable state, ownership, and side effects; consult architecture contracts before changing boundaries. Reproduce with deterministic fault injection and verify recovery and repeated execution without duplicated effects. Bound retries and resource use, preserve cancellation and budgets, and distinguish permanent failure. Avoid blanket exception handling and live production or paid-provider failure experiments.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
