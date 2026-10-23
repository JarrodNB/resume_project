---
name: boundary-loop
description: Reduce demonstrated local module coupling in a bounded loop of independent reviewed PRs.
---

# Boundary Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping.

Use [domain-modeling](../domain-modeling/SKILL.md) if an approved change requires resolving domain terminology, editing the glossary, or recording a consequential decision. Merely reading existing terms does not require it; ownership and contract decisions still go to architecture-loop.

Read the available codebase-design skill and relevant glossary and ADRs. Identify a caller burdened by internal sequencing, representation, or implementation knowledge. Show the maintenance cost and knowledge the caller can stop holding. Make a small behavior-preserving change consistent with ownership and dependency directions. Inspect callers, verify through the public interface, and compare interface complexity and dependencies before and after. Avoid speculative extension points or relocating complexity. Route meaningful ownership, contract, or product decisions to architecture-loop.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
