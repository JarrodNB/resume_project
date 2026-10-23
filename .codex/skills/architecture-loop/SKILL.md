---
name: architecture-loop
description: Explore and implement bounded architecture improvements with user approval of each concrete design and an independently reviewed PR.
---

# Architecture Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping.

Use [domain-modeling](../domain-modeling/SKILL.md) when resolving domain terms, editing the glossary, or recording a consequential decision. Use [research](../research/SKILL.md) when substantial primary-source investigation is needed to assess alternatives; keep its findings within this iteration and ledger. Neither skill replaces the concrete-design decision gate.

Read the available codebase-design skill, glossary, architecture documents, and relevant ADRs. Favor evidenced friction in frequently changed code: shallow interfaces, scattered policy, or unclear ownership. Before implementation, present one concrete candidate with code evidence, affected callers, before/after structure, proposed interface and ownership, alternatives, tradeoffs, and verification plan. Ask for the user's decision and wait; continue only independent inspection while waiting. Invoking this loop or super-loop does not approve unseen designs. Existing explicit approval of the same design satisfies the gate. Implement the chosen design with the shared protocol, preserve behavior unless explicitly approved otherwise, and update affected decisions and domain documentation. Verify through the resulting interface and demonstrate reduced caller knowledge or scattered policy. Proposals and rejected candidates do not count as delivered iterations.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
