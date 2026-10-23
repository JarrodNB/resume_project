---
name: performance-loop
description: Improve measured bottlenecks in a bounded loop of independent reviewed PRs.
---

# Performance Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping.

Require a reproducible representative workload and measured baseline. Identify the limiting query, render, computation, allocation, or network path. Keep inputs, environment, warmup, and repetition comparable; report variability and tradeoffs. Verify correctness, authorization, ordering, and isolation. Prefer operation counts when timing is noisy. Reject gains within noise or obtained by weakening behavior. Do not load-test production or incur substantial costs without authorization. Caches require explicit invalidation and ownership.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
