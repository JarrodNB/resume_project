Ignore this skill for now.
---
name: workflow
description: The process from beginning to end of a Careergrind Kanban item, including planning, approved tickets, TDD subagents, two blind reviews, and a PR for human QA. Use when asked to start or resume this delivery workflow, including a named Kanban item.
disable-model-invocation: true
---

`KANBAN.md` is the user-maintained list of overall work

On Master branch, to be completed is the docs/plans/<feature-slug>/plan.md and docs/plans/<feature-slug>/issues/*.md files, and the work/<feature-slug> integration branch. Both the plan and tickets should be written in plain and easy to understand language.

Before the writing of the plan, the user should be grilled on requirements and design decisions. 

Deep modules describe how to organize the code. A deep module provides useful behavior through a small, simple interface, keeping complicated details inside. Callers have less to learn, tests exercise the same interface callers use, and changes stay concentrated in one place. This is the design we want to follow.

The plan doc:
 # Problem Statement 
 # Human decisions
 # User Stories
 # Solution
 # Implementation Decisions
 # Testing Decisions
 # Arcitecture Decisions
 # Observable Acceptance Criteria
 # Dependencies and Verification
 # Out of Scope
 # Additional Notes

 Once the plan gains human approval, the tickets should be written in a single markdown file. Tickets should be in vertical slices as much as possible. A vertical slice means a end to end process that spans all layers(DB, Frontend, API, AI, etc). It should ideally be independently demoable or verifiable.

 The tickets doc:
 **What to build:**
 **Blocked by:**
 **Layers:**
**Modularity:**
 **Status:**
 **Acceptance Criteria:**
 **Verification:**

 All tickets that are not blocked should be implemented in parallel by subagents. Each subagent should be given the plan and ticket context, repository instructions, acceptance criteria, branch/base context, and should follow TDD as describe below. Each subagent should return changed files/commits, red/green evidence, actual check results, and concerns.

 #### TDD

 Read repository instructions and existing tests, then implement one observable acceptance behavior at a time through a real interface:

 1. **Red:** Write one focused test and run it. Confirm it fails because the behavior is missing; setup errors do not count. If it already passes, find an uncovered requirement instead of forcing a failure.
 2. **Green:** Make the smallest production change that passes the test, then run it again.
 3. **Refactor:** Improve the code while keeping relevant tests green. Repeat for the next behavior, then run broader checks across the necessary layers and meaningful failure paths.

 Test observable results, errors, saved state, or emitted work. Avoid private-method assertions and tests that mirror the implementation. Stub external services at their boundary without mocking away business behavior. Add regression coverage for bugs and duplicate-delivery coverage when queue changes could affect idempotency.

 Run checks in Docker without browser automation; leave visual/manual checks for the human. Documentation and mechanical edits use appropriate existing/static checks instead of artificial red tests. Report actual red/green commands and results, broader check results, and any execution blockers. Stay within the assigned branch and approved ticket scope; return changed files/commits, acceptance outcomes, and concerns to the orchestrator, which owns integration and ticket status.

 Once implementation is completed, two review subagents should be spawned concurrently with no inherited conversation. One subagent should be given the `review-correctness` skill, and the other should be given the `review-design` skill. Each subagent should be given repository instructions, code access, base/head refs, and useful non-browser check commands.

 #### Blind reviews

 Both reviewers independently inspect the supplied base/head snapshot using repository instructions, code, tests, schemas, and established technical documentation. Do not give them the Kanban item, plan, tickets, implementation reports, PR discussion, commit messages, or each other's findings. If a reviewer already knows requirements or implementation rationale, replace it with a fresh reviewer; ignoring that context does not make the review blind.

 **Correctness review:** Trace changed behavior and surrounding code for incorrect results, regressions, invalid state changes, incompatible callers/schemas, and edge cases. Check authentication, authorization, tenant isolation, input handling, secrets, transactions, races, retries, duplicate queue delivery, and partial failures where relevant. Verify cross-service rules: Rails owns domain writes, long-running AI work uses queues, handlers tolerate duplicate delivery, and LLM/embedding calls follow repository rules. Report missing tests when a concrete uncovered behavior creates credible bug risk. Ground each defect in a specific input or execution path without inventing product requirements.

 **Design review:** Read the `codebase-design` skill and judge changes against actual callers and surrounding code. Check for simple interfaces that hide complexity, cohesive responsibilities, sensible dependency direction, and business logic in the right place. Look for duplicated decisions, callers forced to manage internal sequencing/state, shallow layers, and unnecessary abstractions. Assess whether tests cover observable behavior and failure paths, survive refactoring, and avoid excessive mocking or implementation-mirroring assertions. Check names, file responsibilities, descriptions, and local documentation rules. Suggest focused changes supported by concrete maintenance or test risk; keep optional preferences separate and avoid unrelated refactors.

 Reviewers must not modify source, tests, tickets, or workflow state. Run useful checks in Docker without browser automation, using isolated writable test artifacts when needed. Return reviewed base/head refs, actual commands/results, and limitations. Order actionable findings by severity (P0 urgent, P1 high, P2 normal, P3 low), with file/line evidence, the trigger or concrete risk, impact, and a focused repair direction. Distinguish reproduced failures from code inference and label uncertainty. Explicitly state when there are no actionable findings. Neither review establishes requirements completion or human acceptance.


 Once the reviews are completed, apply the fixes.

 Once the fixes are applied, commit the work and put up a PR.
