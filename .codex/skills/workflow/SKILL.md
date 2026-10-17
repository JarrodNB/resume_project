---
name: workflow
description: Deliver a Careergrind Kanban item through requirements discussion, approved planning and ticket breakdown, parallel TDD implementation, two blind reviews, and a PR for human QA. Use when asked to start or resume this delivery workflow, including a named Kanban item.
---

# Workflow

Own delivery and its recorded state. This skill contains its planning, ticketing, TDD, and review instructions; no other skills are required. Write artifacts in plain language.

## Select and resume

- Read applicable `AGENTS.md` files, `KANBAN.md`, and existing artifacts. Inspect relevant code. Consult `docs/testing.md` for checks, `GLOSSARY.md` for terms, and architecture docs/ADRs when affected contracts require them.
- Use the named item; otherwise take the top item. Ask if selection is ambiguous or the board is empty. Report blockers instead of silently choosing another item.
- Preserve unrelated changes. Resume existing plans, approvals, tickets, and branches; reconcile records with actual files, commits, and checks instead of restarting.
- Leave the item on the board until the human explicitly confirms completion. Checks, reviews, and a PR do not establish human acceptance.
- For research-only work, investigate primary sources and record cited findings and open questions in `docs/plans/<feature-slug>/research.md`. Do not infer authorization to implement recommendations.

## Artifacts and progress

Use a stable lowercase hyphenated feature slug; honor user-supplied names and branches.

- Plan: `docs/plans/<feature-slug>/plan.md`.
- Tickets: one combined `docs/plans/<feature-slug>/tickets.md`, with stable numbered ticket headings. Never renumber existing tickets.
- Integration branch: `work/<feature-slug>`.
- Worker branches: `work/<feature-slug>-<NN>-<ticket-slug>`, each in its own worktree.

Prepare and commit approved planning artifacts on `master`, excluding unrelated changes. Do not switch a dirty checkout or overwrite unrelated branches; use a separate worktree when needed. After both approvals and the planning commit, create the integration branch from that commit and record its base. Honor an explicitly supplied base branch instead of assuming master. Implementation takes place in worktrees. Subsequent progress records travel with the integration branch; do not maintain divergent copies on master.

Maintain a compact delivery record in the plan: source item, phase/next action, actual human approvals tied to the approved revision or content hash, planning commit, integration base/head, branches, ticket dependencies/statuses, actual verification results, review snapshots/outcomes, and PR/manual-QA handoff. Record blockers and unfinished work for resumption. Agent summaries are not new human approvals.

Ticket states: `ready-for-agent`, `in-progress`, `blocked`, `implemented`. Implemented means integrated and verified, not human acceptance. The coordinator owns integration, ticket status, board updates, and PR work.

## Explore and settle decisions

Before writing the plan, inspect the code and discuss requirements and design with the user. Map decisions by dependency. Ask questions in rounds, including only decisions whose prerequisites are settled. Number questions and provide recommended answers with reasons. Wait for answers before asking dependent questions. Find repository/environment facts yourself; ask the user for decisions rather than facts you can inspect. Continue independent exploration while answers are pending.

Cover the user problem, intended behavior, failure cases, scope boundaries, interfaces, and testing decisions as relevant. Record settled choices and open questions. Confirm shared understanding before finalizing the plan; that confirmation alone is not plan approval. Do not invent requirements to fill headings.

Prefer deep modules: useful behavior behind a small, simple interface that hides complicated details. Keep responsibilities cohesive and dependencies directed toward the owning module. Avoid callers managing internal sequencing/state, shallow wrappers, speculative abstractions, and duplicated decisions. Prefer existing public test seams and the highest useful observable interface. Update shared terminology and justified architectural decisions using repository glossary/ADR conventions when needed.

## Plan and approve

Write the plan with these sections, scaled to actual scope:

- Problem Statement
- Human Decisions
- User Stories
- Solution
- Implementation Decisions
- Testing Decisions
- Architecture Decisions
- Observable Acceptance Criteria
- Dependencies and Verification
- Out of Scope
- Additional Notes
- Delivery Record

Describe the problem and solution from the user's perspective. Include relevant module/interface decisions, schema/queue contracts, test seams and existing test examples, verification commands, and a manual-QA outline. Prefer durable descriptions over speculative file inventories; include precise contract snippets when they communicate an agreed decision better than prose.

Present the written plan and test seams. Obtain explicit human plan approval before drafting tickets. Record the approved revision. Material scope/design changes require renewed approval; routine implementation choices and in-scope fixes do not.

## Break down and approve

After plan approval, draft tickets in the single tickets file. Present delivered behaviors, granularity, and blocking edges. Obtain explicit human breakdown approval before implementation or creating the integration branch. Plan approval does not imply breakdown approval. Record the approved revision; material breakdown changes require renewed approval.

Prefer narrow vertical slices: each delivers a complete, independently demoable or verifiable behavior through necessary layers and fits a fresh agent context. A slice need not touch every service. Prefactor first where it makes the approved change easier.

For wide mechanical refactors that cannot land as green vertical slices, use expand–contract: introduce the new form alongside the old, migrate callers in bounded batches, then remove the old form after all migrations. If intermediate batches cannot stay green, explicitly group them behind a final integrate-and-verify ticket and document that limitation.

Each numbered ticket contains:

- **What to build:** observable behavior delivered.
- **Blocked by:** stable ticket IDs or None; only genuine prerequisites.
- **Layers:** layers actually affected.
- **Modularity:** relevant ownership, public interface, and test seam decisions.
- **Status:** one of the states above.
- **Acceptance Criteria:** observable, checkable outcomes.
- **Verification:** intended commands, then actual commands/results and red/green evidence.
- **Progress:** assigned branch/worktree, starting base, resulting commits, blockers, and concerns.

Keep implementation tickets off the overall Kanban board. Commit approved planning artifacts, then create/resume the integration branch.

## Implement with subagents

Run ready tickets concurrently up to agent capacity, only after blockers are integrated and verified. Give each writer a separate worktree and branch based on the current integration head. If isolation is unavailable, serialize writers. Independent dependencies do not guarantee conflict-free writes.

Give workers relevant plan/ticket context, repository instructions, acceptance criteria, branch/base/worktree details, and the TDD instructions below. Workers stay within approved scope and their worktree. Require changed files/commits, acceptance outcomes, actual red/green and broader check results, and concerns. Workers must not mutate the integration branch, combined tickets file, board, or PR.

Integrate commits sequentially. Inspect the integrated diff, resolve conflicts without discarding unrelated work, and verify acceptance criteria on the integration branch before marking implemented and releasing dependents. Run appropriate cross-ticket checks. Record failures truthfully and investigate fixable ones; unrun checks cannot count as passed. Ask about material ambiguity or external blockers while continuing independent work.

### TDD instructions for workers and review fixes

Read repository instructions and existing tests. Implement one observable acceptance behavior at a time through a real interface:

1. **Red:** Write and run one focused test. Confirm failure because behavior is missing; setup errors do not count. If it already passes, find an uncovered requirement instead of forcing failure.
2. **Green:** Make the smallest production change that passes the test and rerun it.
3. **Refactor:** Improve code while keeping relevant tests green. Repeat for the next behavior, then run broader checks across necessary layers and meaningful failure paths.

Test observable results, errors, saved state, or emitted work. Avoid private-method assertions and tests mirroring implementation. Stub external services at their boundary without mocking away business behavior. Add regression coverage for bugs and duplicate-delivery coverage when queue changes affect idempotency.

Run checks in Docker following `docs/testing.md`, without browser automation or browser-driven QA. Leave visual/manual checks to the human. Documentation and mechanical edits use appropriate existing/static checks instead of artificial red tests. Report actual commands/results and execution blockers.

## Two blind reviews

After integration and relevant checks, commit the candidate and fix base/head commit IDs. Verify the full diff contains only intended work. Spawn two fresh reviewers concurrently with no inherited conversation (`fork_turns: none` when supported), one for correctness and one for design.

Give each only repository instructions, code access, the same base/head snapshot, useful non-browser check commands, and its review instructions below. Give the design reviewer the deep-module definition above. Do not send the entire workflow skill or delivery context. Explicitly prohibit reading the Kanban item, plan, tickets, acceptance checklist, implementation reports/rationale, PR discussion, commit messages, or the other review. Replace reviewers who already know that context.

Reviewers may inspect code, tests, schemas, and established technical documentation. They must not modify source, tests, tickets, or workflow state. Run useful Docker checks without browser automation, using isolated worktrees for test-generated artifacts.

### Correctness reviewer instructions

Trace changed behavior and surrounding code for incorrect results, regressions, invalid state changes, incompatible callers/schemas, and edge cases. Check authentication, authorization, tenant isolation, input handling, secrets, transactions, races, retries, duplicate queue delivery, and partial failures where relevant.

Verify repository cross-service rules: Rails owns domain writes, long-running AI work uses queues, handlers tolerate duplicate delivery, and LLM/embedding calls follow repository rules. Report missing tests when a concrete uncovered behavior creates credible bug risk. Ground defects in specific inputs or execution paths without inventing product requirements.

### Design reviewer instructions

Judge changes against actual callers and surrounding code. Check small interfaces that hide complexity, cohesive responsibilities, dependency direction, and business logic ownership. Look for duplicated decisions, callers managing internal sequencing/state, shallow layers, and unnecessary abstractions.

Assess whether tests cover observable behavior and failure paths, survive refactoring, and avoid excessive mocking or implementation-mirroring assertions. Check names, file responsibilities, descriptions, and local documentation rules. Suggest focused changes backed by concrete maintenance/test risk. Separate optional preferences and avoid unrelated refactors.

### Review output and resolution

Each reviewer returns reviewed base/head IDs, actual commands/results, and limitations. Order actionable findings by severity (P0 urgent, P1 high, P2 normal, P3 low), with file/line evidence, trigger or concrete risk, impact, and focused repair direction. Distinguish reproduced failures from code inference and label uncertainty. Explicitly state when there are no actionable findings.

The coordinator separately checks every acceptance criterion; blind review does not establish requirements completion or human acceptance. Validate findings, apply supported in-scope fixes using TDD for behavior changes, document dismissals with evidence, and rerun affected checks.

After substantial fixes to behavior, interfaces, dependencies, or test coverage, commit a new candidate and run another fresh pair of blind reviewers against the final full diff from the original base. Repeat until no actionable findings remain. For purely editorial fixes, inspect the final diff and record why another round was unnecessary. If progress is blocked, record unresolved findings and ask the human instead of claiming a clean review.

## PR and human handoff

After implementation, verification, acceptance checking, and review fixes, commit remaining intended changes and create/update a focused PR using available repository tooling. Invoking this workflow authorizes its branch, commit, and PR work. If access/tooling is unavailable, leave the reviewed branch ready and report the specific blocker.

Describe the concrete problem, resulting behavior, actual checks, review outcomes, limitations, and manual-QA steps. Record and report the PR link, branch, and remaining human checks. Stop at human review and QA. Do not merge, deploy, or clear the board without the relevant human instruction. After explicit completion confirmation, remove only the completed item from `KANBAN.md`.
