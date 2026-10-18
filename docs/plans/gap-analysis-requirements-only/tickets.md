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

**Status:** implemented.

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

Worker confirmed red failures for D1 inclusion, duty-only enqueue/screening, and frontend
acceptance of duty/unknown kinds, then green. Worker final: 64 focused AI tests, 20 Rails
specs (including tailoring start), 12 frontend tests, typecheck and frontend lint passed.
Coordinator reran the same 64 AI tests and 12 frontend tests on integration head `cd7d659`:
all passed. Commands used network-disabled `docker run` with worktree source mounts and
existing development images, as allowed by `docs/testing.md`. Paid eval deferred to 03.
Full AI Ruff has four pre-existing findings in conversation logging files; changed-file
Ruff passes. An initially mistyped test path was corrected before the successful run.

**Progress:** Assigned to `qualifications`; branch
`work/gap-analysis-requirements-only-01-qualifications`, worktree `.worktrees/gap-analysis-01`,
base `25d45c5911f3eaf2b4ff3079ab18e73a6544a00b`. Worker commit `64e1c3c`, integrated as `cd7d659`.
Concern: removing a result kind requires coordinated consumer updates.

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

**Status:** implemented.

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

Worker confirmed red: 14 screen calls rather than four over two deliveries; blocked library
incorrectly proceeded to generation. Green: 23 focused, then 88 broader tests. Full offline
suite: 542 passed, nine DB tests deselected, one unconfigured-Logfire warning (127.35 s).
Coordinator verified the integrated module/handler/screen/evidence/schema/queue-usage/interview
selection/session checks: 89 passed, one same warning (39.38 s), via network-disabled Docker
with integration source mounted. Changed-file Ruff and diff checks passed; full Ruff still
has only four baseline conversation-logging findings.

**Progress:** Worker `library_screening`, branch
`work/gap-analysis-requirements-only-02-library-screening`, worktree `.worktrees/gap-analysis-02`,
base `ccfe3c4957ef0c8da397db7cc4c6302abdcac1cd`. Worker `e7dfb39` integrated as `3c95613`.
Exact binding and retained usage verified; no unresolved concern.

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

**Status:** implemented.

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
static checks for documentation; do not invent red tests for reporting edits. Actual results
are in `verification/verification.md` and raw reports/reproducers. Screening requests fell
19→2, 87→3, 87→5. One live sample reduced screening 91.325→7.852 s and total
106.642→20.726 s, one generation request each. Final paid eval: nine completed, zero
execution errors; coverage/evidence/gap recall 1.0, verdict/met agreement 0.9444. Original
eval had one screening outage and successful isolated retry; both versions show the same
two verdict mismatches. Final Python-tenure prose also contains a model arithmetic error,
disclosed for QA. No quality gain is claimed.

**Progress:** Worker `verification`, worktree `.worktrees/gap-analysis-03`, branch
`work/gap-analysis-requirements-only-03-verification`, base `a9b3a32`. Worker commits
`82962bc`, `f0a2c78`, `9214343` integrated as `723c2df`, `8017a1f`, `b698490`.
Reporting-only diff inspected; two stale phrases corrected editorially. No production
changes after the reviewed source snapshot. Measurements are single observations.

## Coordinator handoff after ticket integration

Coordinator owns combined ticket status updates, sequential integration, acceptance checks,
and candidate base/head snapshots. Workers cannot modify this file, the board, or PR state.
Run two fresh blind reviews (correctness and design), resolve supported findings, and repeat
both reviews after substantial fixes. Create and attach the reviewed PR, then stop for human
QA. Keep the Kanban item until explicit completion confirmation. These steps remain required
and are not separate implementation tickets.
