---
name: orchestrator
description: Coordinate a Careergrind Kanban item through planning, approved tickets, TDD subagents, two blind reviews, and a PR for human QA. Use when asked to start or resume this delivery workflow, including a named Kanban item.
---

# Orchestrator

Own the delivery process and its recorded state. `KANBAN.md` is the user-maintained list of overall work; local Markdown files hold plans and implementation tickets. This skill describes the process without Plane or a temporary workflow document. All work should be done in a worktree.

## Select and resume

- Read root and applicable `AGENTS.md` instructions, the board, and existing work for the selected item. Preserve unrelated changes.
- Use the item the user names; otherwise take the top item. If blocked, explain rather than silently selecting another. Ask if the board is empty or selection is ambiguous.
- Resume existing plans, approvals, branches, and tickets. Check recorded status against actual files, commits, and checks; do not recreate completed work.
- Leave the item on the board until the human explicitly confirms completion. Then remove only that item. Implementation, a passing review, or a PR is not that confirmation.

## Artifacts and naming

- Use a stable lowercase hyphenated feature slug. Honor user-supplied identifiers or branches.
- Plan: `docs/plans/<feature-slug>/plan.md`. Tickets: one file each at `docs/plans/<feature-slug>/issues/01-<ticket-slug>.md`, numbered in dependency order. Do not renumber published tickets.
- Integration branch: `work/<feature-slug>`. Isolated ticket branches when needed: `work/<feature-slug>-<NN>-<ticket-slug>`. Reuse recorded branches on resume; never overwrite an unrelated branch.
- In the plan record the source item, phase/next action, approvals, base/head commits, branches, linked tickets/dependencies/statuses, actual verification results, review summaries, and PR/manual-QA handoff.
- Record each approval from the human's actual response, tied to the approved revision or content hash. An agent summary is not new approval. Material scope/breakdown changes require renewed approval.
- Ticket states: `ready-for-agent`, `in-progress`, `blocked`, `implemented`. Implemented means integrated and verified, not human acceptance of the overall item. Record blockers and results on each ticket.
- Create/update local `AGENTS.md` indexes as required by the repository.

## Research route

For a research-only item, read and use `research`. Give its background agent the question, relevant context, and `docs/plans/<feature-slug>/research.md` as the output path. Inspect the cited findings and report remaining questions. Do not start implementation just because research suggests changes. Await human confirmation before clearing the board item.

## Plan and approve

1. Explore relevant code and read `grilling`, `domain-modeling`, `codebase-design`, and `to-spec`. Use `to-spec` for the PRD/spec step; no separate PRD skill is required.
2. Use grilling to settle requirements and design decisions, domain-modeling to record resolved terms and justified decisions, and codebase-design to choose interfaces/test seams. Do not invent requirements to fill a template.
3. Supply `to-spec` this configuration: local Markdown tracker, the plan path above, no external publication or triage service. Use its template for the substantive spec. Add observable acceptance criteria, dependencies, verification commands, and a manual-QA outline. Proposed work is not yet `ready-for-agent`.
4. Present the written plan including test seams. Wait for explicit human plan approval before creating the branch or ticket files. Grilling agreement alone is not approval.

## Break down and approve

1. After plan approval, create/resume the integration branch and record its base commit for review and PR scope. Ensure that you are branching off of master and that master is current.
2. Read/use `to-tickets`, configured to publish local files at the issues path above instead of `.scratch/`. Each normal ticket delivers a narrow, complete, independently verifiable behavior through necessary layers and fits a fresh agent context. Follow its prefactoring and expand–contract guidance where applicable.
3. Present the proposed tickets, delivered behaviors, and blocking edges. Wait for human breakdown approval before publishing tickets or implementing. Plan approval does not imply breakdown approval.
4. Publish individual tickets using the skill's local template, extended with progress, branch/worktree, resulting commits, test evidence, and blockers. Record the dependency graph in the plan. Keep implementation tickets off the overall Kanban list.

## Implement with subagents

- Delegate approved tickets to implementation subagents with relevant plan/ticket context, repository instructions, acceptance criteria, branch/base context, and the local `tdd` skill. Require changed files/commits, red/green evidence, actual check results, and concerns.
- Run tickets concurrently only when blockers are integrated and verified. Independent dependencies do not guarantee conflict-free writes: use separate worktrees for concurrent writers, or serialize if isolation is unavailable. Assign each worker its own worktree/branch. Workers must not mutate the shared integration branch, board, or PR.
- Integrate completed ticket commits sequentially. Inspect changes and check acceptance criteria on the integration branch before marking implemented and releasing dependents. Resolve conflicts without discarding unrelated work.
- Use TDD for behavior changes and run relevant checks in Docker. Do not use browser automation, browser-driven tests, or browser QA. Non-browser component/service/integration tests are appropriate; manual QA belongs to the human.
- Record failures truthfully, investigate fixable failures, and ask about material ambiguity or external blockers. Unrun checks cannot be counted as passed.

## Two blind reviews

1. After integration and relevant checks, fix the candidate base/head commits and verify the diff contains only intended work. Both reviewers assess this same snapshot.
2. Spawn two fresh reviewers concurrently with no inherited conversation (`fork_turns: none` when supported). Give one `review-correctness`, the other `review-design`, plus repository instructions, code access, base/head refs, and useful non-browser check commands.
3. Do not provide the Kanban item, plan, tickets, acceptance checklist, implementation rationale, agent reports, or the other review. Instruct reviewers not to read these artifacts, PR discussion, or commit messages. Code, tests, schemas, and established technical documentation are available. Use read-only source access or isolated worktrees for test-generated files.
4. Separately check every acceptance criterion; blind review does not establish requirements completion.
5. Validate findings. Implement supported in-scope fixes as the orchestrator, using TDD for behavior changes. Document dismissals with evidence and rerun affected checks.
6. Substantial fixes (behavior, interfaces, dependencies, or test coverage) require another pair of fresh blind reviewers of the final full diff. Repeat until no actionable findings remain. If progress is blocked, record it and ask the human instead of claiming a clean review. For purely editorial fixes, inspect the final diff and record why another round was unnecessary.

## PR and handoff

- After implementation, verification, and review fixes, create/update a focused PR using available repository tooling. Invoking this delivery workflow authorizes its branch, commit, and PR work, not merge or deployment. If tooling/access is unavailable, leave the reviewed branch ready and report the specific blocker.
- Describe the problem, resulting behavior, checks actually run, review outcomes, and manual-QA steps. State limitations plainly and exclude unrelated work from commits/PR.
- Report the PR/branch and hand off for human review and manual QA. Stop here. Do not merge, deploy, or clear the board without the relevant human instruction.
