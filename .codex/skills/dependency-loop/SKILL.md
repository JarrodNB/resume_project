---
name: dependency-loop
description: Upgrade dependencies with verified compatibility in a bounded loop of independent reviewed PRs.
---

# Dependency Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping.

Inspect manifests, lockfiles, runtime constraints, callers, and official release or migration notes. Verify current version facts with official sources. Choose one direct dependency or necessary coupled package family with a concrete support, security, compatibility, or capability benefit. Use the repository package manager in Docker to regenerate lockfiles and inspect transitive changes. Run required affected build, type, lint, and behavior checks. Include necessary compatibility changes only. Defer major migrations with unresolved design choices. Verify affected and fixed version ranges before claiming security remediation.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
