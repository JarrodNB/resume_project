---
name: test-quality-loop
description: Add missing regression coverage or improve existing test reliability, assertions, isolation, and maintainability in a requested bounded loop of independent reviewed PRs.
---

# Test Quality Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md).

Choose one demonstrated test gap or weakness: missing consequential coverage, assertions that allow incorrect behavior, brittle implementation mocks, nondeterminism, shared-state leakage, or redundant tests that obscure distinct cases. Record evidence and the intended improvement before editing. Derive behavioral expectations from documented contracts and callers, not the implementation alone.

For missing coverage or weak assertions, explain which realistic regression the test should detect. Test observable interfaces rather than private methods or mocks that repeat implementation. Verify the final test passes on unchanged production behavior; when practical, temporarily introduce a representative regression and show the test catches it, then remove the mutation.

For brittle mocks, replace internal choreography assertions with meaningful outcomes while preserving useful external-boundary isolation. For flaky tests, reproduce the failure or identify a concrete uncontrolled input, race, ordering dependency, or shared resource. Repair the cause with deterministic setup, clocks, synchronization, or isolation. Rerun under the relevant stressor, such as randomized order or repeated execution, and report actual repetitions and limits; a single green rerun does not establish a flake repair.

For redundant tests, identify the equivalent behavior being tested and preserve distinct input partitions, authorization cases, side effects, and failure paths. Consolidation must retain regression detection. Verify the affected group and relevant neighboring tests to catch isolation regressions.

Do not improve apparent quality by skipping tests, weakening assertions, adding arbitrary sleeps or blanket retries, deleting unique cases, or chasing coverage percentages and test counts. Keep production behavior unchanged; fixture and test-harness repairs may belong in the same iteration. Record discovered production defects for fix-loop rather than silently expanding scope.

When coordinated by super-loop, use its selected quota, base, scope, and ledger. Complete one independent iteration at a time without resetting run state or creating a nested quota. Report exhaustion or blockers rather than substituting another category.
