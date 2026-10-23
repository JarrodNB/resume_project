---
name: simplify-loop
description: Simplify demonstrated code complexity while preserving behavior in a bounded loop of independent reviewed PRs.
---

# Simplify Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping.

Choose unnecessary branching, duplicated policy, indirection, or dependency burden with a concrete maintenance cost. Establish baseline behavior through existing public-interface tests, adding characterization tests only for meaningful gaps. Preserve authorization, side effects, failure semantics, and public contracts. Show a real reduction in concepts, branching, duplication, or dependencies; skip changes that merely relocate complexity or reflect naming preferences.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
