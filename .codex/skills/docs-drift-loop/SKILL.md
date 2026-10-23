---
name: docs-drift-loop
description: Correct verified mismatches between maintained documentation and code in a bounded loop of independent reviewed PRs.
---

# Docs Drift Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping.

Use [domain-modeling](../domain-modeling/SKILL.md) when correcting glossary entries or ADRs. Preserve established decisions; an unresolved domain or product question needs a user decision rather than a documentation-only answer.

Choose one consequential inaccurate claim, stale command, broken navigation path, or missing documented constraint. Trace authoritative code, configuration, and decisions to determine whether code or documentation is wrong; record product defects separately. Verify commands in isolation where practical and check links, paths, and examples. Report commands that could not run. Update the owning document rather than duplicate guides, exclude secrets and personal environment values, and do not promote uncertain behavior into a new contract.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
