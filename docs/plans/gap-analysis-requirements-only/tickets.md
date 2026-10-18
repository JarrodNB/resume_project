# Gap analysis delivery tickets

Plan and breakdown approved on 2026-10-18. Implementation is authorized.

## 01 — Compare qualifications only

**What to build:** Gap analysis compares saved requirements and nice-to-haves, with no
responsibility assessments. Responsibility-only jobs cannot start analysis; nice-to-have-only
jobs can. Deliver the complete behavior across Rails, AI, and the result view.

**Blocked by:** None.

**Layers:** Rails enqueue service/specs, AI context projection, prompt/output contracts,
validation/evals, frontend result parser/view/tests, affected technical guidance.

**Modularity:** Keep Rails validation in its service. Keep qualification projection with
gap-analysis preparation/building, not in callers. Preserve deterministic evidence attachment.
Narrow the Python/TypeScript result kind together; audit tailoring consumers. Do not change
saved-job responsibilities or extraction. Use service, handler/provider, and rendered result
interfaces as test seams.

**Status:** ready-for-agent.

**Acceptance Criteria:**

- Mixed jobs produce only R/N assessments in posting order; responsibilities are absent from
  screening/generation inputs, verdicts, and summary instructions.
- Rails rejects responsibility-only jobs without enqueueing. The worker independently rejects
  them before screening/generation. Nice-to-have-only analysis remains supported.
- The result contract and UI contain required/preferred groups only; evidence, counts, and
  saved gap responses keep working. No historical-result compatibility is added.
- Evals expect only the two qualification kinds and include responsibility-bearing inputs.
- Downstream readers remain compatible; saved job responsibilities remain available elsewhere.

**Verification:** TDD at each observable seam. Intended commands:

```bash
docker compose run --rm api bundle exec rspec spec/services/gap_analysis/start_gap_analysis_service_spec.rb spec/graphql/mutations/analyze_job_gaps_spec.rb
docker compose run --rm ai pytest -m "not db" tests/test_analyze_gaps_handler.py tests/test_build_gap_analysis_prompt.py tests/test_find_gap_analysis_problems.py tests/test_gap_analysis_evaluators.py
docker compose run --rm --no-deps web npm test -- src/features/gap-analysis
docker compose run --rm --no-deps web npm run typecheck
```

Run affected evidence/tailoring tests identified by caller inspection. Coordinator runs paid
gap evals against the final integrated candidate in ticket 03. Actual red/green and broader
results: not run.

**Progress:** Unassigned. Branch/worktree/base/commits: pending breakdown approval and planning
commit. Concern: removing a result kind requires coordinated consumer updates.

## 02 — Screen the complete library through one preparation interface

**What to build:** Gap analysis sends its library as one cohesive screening source, reusing
the import chunker. Any blocked or incomplete screen stops analysis. Hide preparation behind
a small public operation so the handler only coordinates reading, preparation, generation,
and result publication.

**Blocked by:** 01, because preparation must build the agreed qualification-only context and
both tickets touch the same handler/prompt boundaries.

**Layers:** AI context preparation, screening integration, handler, prompt binding, usage and
error reporting, focused tests, affected technical guidance.

**Modularity:** A dedicated gap-analysis preparation module owns serialization, source limits,
screening, reconstruction, exact prompt binding, and screening usage. Expose prepared prompt
and usage or a typed failure retaining usage; callers must not sequence internal steps.
Reuse shared screening/session policy rather than copying it. Preserve existing interview
entry-selection behavior. Remove gap-only obsolete hooks only after inspecting all callers.

**Status:** blocked.

**Acceptance Criteria:**

- The entire library, including every supported entry type and summary, is serialized as one
  source. A library fitting the configured chunk size uses one screen call.
- Larger sources use the existing overlapping chunk policy. A rejected later chunk stops
  the analysis; generation never receives a partial library.
- Job screening happens separately first. Rejected/unchecked sources produce useful failures;
  source/prompt caps, task deadline, usage limits, contact masking, and billed usage remain
  enforced, including calls made before failure.
- The assembled library uses the existing 80,000-character screening cap, and the final
  prompt keeps its 120,000-character cap. Oversize input fails without truncation.
- Exact approved prompts avoid another screening pass; unknown direct prompts remain guarded
  and a fresh delivery screens again. All untrusted values render from approved sources.
- Evidence labels/text/order are preserved for the complete approved library. Interviews
  retain their current screening and omission behavior.
- No screening-policy duplication, parallel screening, or model change is introduced.

**Verification:** TDD with production screener/agent paths and provider fakes. Include small
and multi-chunk libraries, blocked later chunk, missing credentials, provider error, size
boundaries, deadline/usage-cap propagation, billing before failure, exact coverage and repeat
delivery. Test all library entry kinds through preparation. Intended commands:

```bash
docker compose run --rm ai pytest -m "not db" tests/test_gap_context_screening.py tests/test_analyze_gaps_handler.py tests/test_build_gap_analysis_prompt.py tests/test_schema_dependencies.py
docker compose run --rm ai ruff check .
```

Add the new module's focused tests and existing shared-screening, evidence, usage/privacy,
and interview regression tests discovered during inspection. Actual results: not run.

**Progress:** Unassigned. Branch/worktree/base/commits: pending. Dependents release only after
01 is integrated and verified. Concern: exact whole-source coverage must not implicitly
approve arbitrary entry strings or discard usage on failure.

## 03 — Verify integrated behavior and quantify reduced screening work

**What to build:** A reproducible synthetic comparison demonstrates screening request counts
and measured runtime effects, with final regression/eval results and accurate documentation
of the combined behavior. This is the integration verification slice; 01 and 02 must each
already pass their focused checks.

**Blocked by:** 01 and 02.

**Layers:** Synthetic verification fixtures/reporting as needed, gap eval cases/runner only
if needed for meaningful measurements, technical documentation. No new product behavior.

**Modularity:** Exercise the handler/preparation public interfaces and existing tracing/model
boundaries. Keep measurement scaffolding out of the production handler. Use the same
synthetic fixtures/configuration on the original base and final candidate. Do not treat
the existing generation-only eval runner as a worker-screening benchmark.

**Status:** blocked.

**Acceptance Criteria:**

- Record before/after screening request counts for many short entries and a multi-chunk
  library. Explain differences due to serialization size and configured overlap.
- Record screening time, generation time, retries, and total processing time where real
  provider credentials are available. Clearly distinguish fake-delay measurements and
  state unavailable measurements; no unsupported speed claim or fixed latency promise.
- Final gap evals and affected AI, Rails, and frontend checks run with actual outcomes.
  Investigate fixable failures. Record external access blockers truthfully.
- Documentation describes qualification-only analysis, whole-library failure behavior,
  source limits, and the thin preparation interface.
- Coordinator verifies all plan acceptance criteria and provides manual-QA steps before
  fresh blind reviews and PR handoff. Human acceptance remains pending.

**Verification:** Run the commands in the plan, including
`docker compose run --rm ai python -m evals.run_gap_analysis_evals`, AI lint/schema dependency
checks, frontend typecheck/lint, focused regressions, and synthetic comparisons. Use existing
static checks for documentation; do not invent red tests for reporting edits. Actual results:
not run.

**Progress:** Unassigned. Branch/worktree/base/commits: pending. Capture any baseline needed
from the original integration base before changing production behavior. Credentials may
limit live timing/evals; report such limits rather than counting them as passed.

## Coordinator handoff after ticket integration

Coordinator owns combined ticket status updates, sequential integration, acceptance checks,
and candidate base/head snapshots. Workers cannot modify this file, the board, or PR state.
Run two fresh blind reviews (correctness and design), resolve supported findings, and repeat
both reviews after substantial fixes. Create and attach the reviewed PR, then stop for human
QA. Keep the Kanban item until explicit completion confirmation. These steps remain required
and are not separate implementation tickets.
