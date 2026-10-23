# Ponytail guidance for delivery subagents

This is Careergrind's local adaptation of [Ponytail core](https://github.com/DietrichGebert/ponytail/blob/09c434ab73ca43761c5d8b0c5d341926c2fba710/skills/ponytail/SKILL.md) and [Ponytail review](https://github.com/DietrichGebert/ponytail/blob/09c434ab73ca43761c5d8b0c5d341926c2fba710/skills/ponytail-review/SKILL.md), pinned to upstream commit `09c434ab73ca43761c5d8b0c5d341926c2fba710`. See the repository's `docs/research/ponytail-workflow-integration.md` for the assessment. Workers and blind reviewers need only the relevant section below, not that research or delivery context.

Use these instructions explicitly for each assigned implementation or review task. They require no plugin, installation, hooks, mode files, or session-wide activation. Repository instructions and the delivery workflow remain authoritative.

## Implementation

Apply Ponytail's `full` approach within the approved ticket and its red–green–refactor cycles:

- Inspect existing behavior and all affected callers, tests, fixtures, configuration, and exports before changing an interface. Complete the whole approved behavior and repair affected uses.
- Choose the first suitable solution in this order: existing project code or patterns, standard library/platform facilities, installed dependencies, then new code. Preserve house components and conventions. Check whether a proposed dependency or helper is actually necessary.
- Prefer the simplest readable implementation that meets the acceptance criteria. Avoid speculative options, wrappers, abstractions, and unrelated cleanup. Preserve cohesive module boundaries; fewer lines alone do not make a better design.
- Preserve validation, error handling, security, accessibility, idempotency, and service ownership. Moving code must retain these protections. Fix shared causes after tracing callers rather than patching one symptom.
- Keep required human-friendly file headers and interface documentation. Follow the assigned TDD and Docker verification instructions, including meaningful failure paths; an upstream minimal self-check does not replace them.
- Report changed files/commits, completed acceptance criteria, actual red/green and broader checks, and remaining limits. Do not change workflow state, skip requirements, or infer approval from a smaller solution.

## Review

Use this checklist within the assigned correctness or design review, preserving its scope, blind-context restrictions, and output format:

- Read the connected code as well as the diff. Trace inputs through callers, callees, stored state, and outputs. Search every caller when a signature, return value, or behavior changes.
- For correctness, examine concrete edge cases, lost validation/error handling, trust boundaries, races, retries, duplicate work, and partial writes. Assess resource growth, repeated queries, and shared state against load supported by code or deployment evidence; label assumptions rather than inventing scale requirements.
- For design, check whether existing project facilities could replace new machinery. Name the existing path when recommending reuse. Identify dead options, duplicated decisions, or mixed responsibilities only where they create a concrete maintenance or test risk. Do not treat a single implementation or a line count as proof that an abstraction is wrong.
- Check whether risky changed behavior has a test that would catch its failure. Preserve the local coverage standard; one passing test alone does not establish adequate coverage.
- Before reporting, confirm the caller and triggering condition exist. Give a concrete case or supported maintenance risk, impact, file/line evidence, and a focused repair direction. Distinguish reproduced failures from code inference; separate optional preferences from actionable defects.
- Remain read-only. A documented shortcut still needs scrutiny if it violates repository rules or fails within the supported use. Report actual checks and limitations using the assigned review format. Ponytail's upstream verdict and lines-saved metrics do not replace that format, authorize merging, advance workflow state, or establish human acceptance.
