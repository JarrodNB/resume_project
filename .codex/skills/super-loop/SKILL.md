---
name: super-loop
description: Coordinate a bounded quota of each repository improvement loop with independent reviewed PRs and resumable per-category progress when the user requests a super loop or X of each loop.
---

# Super Loop

Coordinate the selected delivery loops; creating this skill does not start a run.

## Resolve quotas

Require a positive integer X for "X of each." By default include all twelve categories below, targeting 12 × X independent PRs. Honor a selected subset, custom order, or explicit per-category overrides; zero excludes a category. Reject negative or ambiguous counts. State resolved categories, quotas, order, and total before starting without asking for redundant confirmation.

| Category | Skill |
| --- | --- |
| Existing defects | [fix-loop](../fix-loop/SKILL.md) |
| Regression coverage and test quality | [test-quality-loop](../test-quality-loop/SKILL.md) |
| Unnecessary complexity | [simplify-loop](../simplify-loop/SKILL.md) |
| Failure recovery | [resilience-loop](../resilience-loop/SKILL.md) |
| Measured bottlenecks | [performance-loop](../performance-loop/SKILL.md) |
| Accessibility barriers | [accessibility-loop](../accessibility-loop/SKILL.md) |
| Interaction friction | [ux-friction-loop](../ux-friction-loop/SKILL.md) |
| Inaccurate documentation | [docs-drift-loop](../docs-drift-loop/SKILL.md) |
| Diagnostic gaps | [observability-loop](../observability-loop/SKILL.md) |
| Dependency upgrades | [dependency-loop](../dependency-loop/SKILL.md) |
| Local module coupling | [boundary-loop](../boundary-loop/SKILL.md) |
| Architecture decisions | [architecture-loop](../architecture-loop/SKILL.md) |

## Coordinate

Read the [shared protocol](references/iteration-protocol.md). Use one ledger with requested, completed, exhausted, blocked, and pending-decision state for each category. Read each selected skill immediately before working on that category. For fix-loop, follow its existing full workflow, including its branch naming and review requirements, using the shared ledger.

By default run sequential round-robin in table order: one iteration per eligible category, then repeat until quotas are satisfied or no category can progress. Honor user-selected order. Do not launch nested whole-skill runs, parallel implementations, or a second ledger. Fresh reviewer subagents remain required.

Assign candidates to exactly one category before implementation. Check overlap with earlier work and open PRs. Tests, documentation, telemetry, and compatibility work needed for another improvement remain in that PR and earn no extra credit. Never reclassify completed work to hide shortfalls or depend on unmerged earlier PRs.

Architecture-loop always retains its concrete-design decision gate. Present the candidate and request the user's choice before implementation, mark it pending, and continue only independent work. Other categories may expose product decisions too. A quota does not authorize inventing the answer.

If reasonable inspection exhausts a category, record evidence and its shortfall and continue other eligible categories. Do not transfer quota or weaken evidence standards. Required verification, access, publication, or fresh-review blockers stop the entire run, preserving partial work; do not repeatedly retry blocked actions.

On resume reconcile ledger, worktrees, remote heads, and PRs before mutations. Count each PR once, after its final remote head passes fresh review.

For older run ledgers, treat the former coverage-loop category as test-quality-loop: preserve its requested quota, completed PRs, and evidence without counting it as an additional category.

## Handoff

After each completion report category progress and PR. At handoff report requested/completed counts per category, all PRs and reviewed heads, actual verification and limits, retained worktrees, exhausted categories, pending decisions, and blockers with next actions. Explicitly identify unmet targets. Leave merging and deployment to the human.
