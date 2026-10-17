# Masking on import — implementation tickets

Plan: [plan.md](plan.md). Plan and breakdown approved by the user.
Statuses describe prerequisites, not permission to start before breakdown approval.

## 01 — Local reversible PII module

**What to build:** A self-contained module that prepares document text for external AI
calls and restores original names, emails, and phone numbers in structured results.
This is a prerequisite slice verified through its public API; imports are connected in 02.

**Blocked by:** None.

**Layers:** AI PII module, dependency lockfile, AI container/model packaging, offline tests.

**Modularity:** `services/ai/pii/` owns detection, span overlap resolution, placeholder
allocation, exact restoration, and map lifetime. Expose document preparation returning
masked text and a per-import session with masking/restoration operations. Keep Presidio
and spaCy details private. The provider and telemetry adapters in 02 must be able to use
the session without inspecting replacement pairs. Avoid moving unrelated task behavior.

**Status:** implemented.

**Acceptance Criteria:**

- Real local Presidio/spaCy detection covers the agreed synthetic names, email, and
  international phone fixtures without profile contact. Enable only the three approved
  entity types. Document measured limitations; do not promise perfect detection.
- Masked text has distinct, collision-safe typed placeholders. Repeated identical values
  use stable placeholders. Overlapping matches and pre-existing placeholder-like text
  round-trip safely, including exact case and punctuation.
- Structured strings restore recursively; generated unresolved placeholders cause a
  safe failure. Useful non-PII resume facts remain intact on representative fixtures.
- Maps remain in memory and isolated per import; no map is logged or serialized.
- Known profile protection can compose with detected protection without placeholder
  collisions or restoration to a different value.
- Pin compatible detector/model dependencies, confirm Python 3.13 compatibility and
  licensing, and bundle the model so analysis needs no runtime model downloads.
- Missing assets and detector errors surface safely without exposing document content.

**Verification:**

- TDD at the public preparation/restoration interface; record actual red/green results.
- `docker compose build ai`
- `docker compose run --rm --no-deps ai pytest -m "not db" tests/test_pii.py`
  (`test_pii.py` is the proposed new test module).
- `docker compose run --rm --no-deps ai ruff check .`
- Verify real analysis with networking disabled using the built image and synthetic
  text; record the actual image/command plus model loading time and image size.
- Actual: worker real-detector suite 16 passed; integration verification of
  `tests/test_pii.py tests/test_contact_mask.py` in `careergrind-pii-ai:latest`
  with network disabled and dummy API key: 21 passed. Scoped Ruff and diff checks pass.
  Red/green regressions cover session serialization and private-domain emails.
  Python 3.13.11 image build/model-load passed, image about 884 MB; cold preparation
  1.886s and warm short-document preparation 0.005–0.017s. Full Ruff has four existing
  errors outside the ticket. Detection limits and licenses are in `pii/README.md`.

**Progress:** Assigned to PII module agent in `.worktrees/masking-on-import`, branch
`work/masking-on-import-01-local-pii`, base `6722f8a`. Worker commit `83ec5c0`,
integrated as `f1592c5` and verified before releasing 02.
Dependency setup problems must be reported rather
than silently replacing the approved detector. Ready for 02 only after integration and
verification on the integration branch.

## 02 — Protect the complete resume import lifecycle

**What to build:** Imported names, emails, and phones stay masked on both AI providers
and remote telemetry; the completed result contains the original values. Connect the
module and its observability protection in one slice so imports are not partially protected.

**Blocked by:** 01.

**Layers:** AI import handler, existing contact/provider hooks, tracing and transcript
adapters as needed, synthetic integration tests, architecture and affected guidance.

**Modularity:** The handler coordinates preparation, screening, parsing, restoration,
and source checks. The PII module owns replacement decisions. Existing hooks and
telemetry adapters consume the session without duplicating detection. Preserve other
task types' known-contact behavior and existing queue/domain ownership.

**Status:** implemented.

**Acceptance Criteria:**

- Validate original document limits, then prepare the full extracted text locally
  before the first screening call. Both screening and parsing provider captures contain
  placeholders, including contact absent from or different from profile contact.
- Real detector and fake-provider integration covers multiple entities, repeated values,
  retries/fallback, and contact appearing in highlights or other structured fields.
- Restore output before source-faithfulness checks and result publication; original
  highlights survive and generated placeholders/maps are not stored in result data.
- Detector failure produces a safe import failure with zero AI provider requests.
  No-entity documents can proceed normally.
- Screening rejection/unavailability, unreadable/oversized files, deadlines, and request
  accounting retain behavior. Screening approvals bind the exact masked source.
- Captured remote telemetry stays masked for inputs, restored responses, errors, parent
  spans started before detection, and export after session exit. Concrete request
  transcripts contain masked requests; no replacement map is recorded.
- Duplicate deliveries and sequential users cannot leak or reuse maps. Existing tasks
  outside imports retain contact protection.
- Architecture guidance describes the local privacy boundary and detection limitations.
  No GraphQL or queue schema changes are expected.

**Verification:**

- TDD through the import handler and actual provider request seam; use real detection
  in representative integration tests and fake external providers, not real user data.
- `docker compose run --rm --no-deps ai pytest -m "not db" tests/test_pii.py tests/test_contact_mask.py tests/test_tracing.py tests/test_tracing_integration.py tests/test_conversation_logging.py tests/test_conversation_logging_reliability.py`
- Run the import regression module discovered from existing handler tests and record its
  exact path/command; include worker lifecycle tests for publication and usage accounting.
- `docker compose run --rm --no-deps ai pytest -m "not db"`
- `docker compose run --rm --no-deps ai ruff check .`
- `git diff --check`
- If prompts/agent behavior change, use the existing parsing eval runner with synthetic
  inputs and report actual paid-provider results or limitations per `docs/testing.md`.
- Actual: worker focused lifecycle run 82 passed; follow-up privacy/screening run 43
  passed. Coordinator final offline full suite: 515 passed, 9 database tests deselected,
  one existing Logfire-not-configured warning. Used `docker run --rm --network none
  -e OPENAI_API_KEY=offline-test-key` with this integration checkout mounted at `/app`
  and `careergrind-pii-ai:latest`, running `pytest -m "not db"`.
- Every changed Python file passes scoped Ruff; `git diff --check` passes. Full Ruff's
  four existing errors were reproduced in untouched master (two BLE001 in transcript
  logging; I001/SIM117 in its reliability test). No unrelated lint fixes included.
- Paid synthetic `python -m evals.run_resume_parsing_evals` ran using the existing AI
  environment file with remote Logfire export disabled. Initial evaluation exposed a
  combined name/email span and a date mistaken for phone, plus one fail-safe unresolved
  token error. Added detector regressions and prompt version 7 to preserve fields by
  layout. Final six-case evaluation completed without errors; all reported scores 1.0.
- Detector-refinement TDD: three observed regressions failed before the fix; final
  20 detector plus 14 import tests passed. PERSON detection now respects lines/columns;
  structured contact spans take priority and month/year date ranges are preserved.
- Additional behavioral red/green evidence: provider-boundary masking, case-altered
  tokens failing safely. Tests inspect exported events/status and late exception logs.

**Progress:** Assigned to lifecycle agent in `.worktrees/masking-import-lifecycle`,
branch `work/masking-on-import-02-import-lifecycle`, base `6c5af29` after verified 01.
Worker commits `f29a030`, `2760d94`, and `6a52ad3`, integrated as `c0776e0`, `d83e9f7`,
and `d33c24b`. Root prompt refinement `cfc3080`; detector worker follow-up `fc2cac7`
integrated as `5a9b563`. All acceptance criteria verified in code/tests; human QA pending.
Round 1 correctness review then reproduced a valid-size import failing the separate
120,000-character generative cap after masking expansion. Reopened 02 for a real-guard
regression and scoped original-length check. Fix branch `work/masking-on-import-length-fix`,
worktree `.worktrees/masking-length-fix`, base `9c034d2`. Full final diff requires new reviews.
Fixed by worker `c7f8000`, integrated as `5ac491b`. Valid long import fails before the
fix and passes afterward through the real guard. Five boundary tests preserve raw,
unknown-history, and other-task caps; 76 focused tests pass. Coordinator reran final
full offline suite: 520 passed, 9 database tests deselected, one existing warning.
Repeated final six-case real-provider evaluation: no errors, all reported scores 1.0.
Changed-file Ruff/diff checks pass. Fresh review pair on original base `f69499b` through
candidate `6604aa7`: correctness and design both report no actionable findings.
Correctness independently ran 90 focused tests and all 520 offline tests; design ran
89 focused tests and changed-file Ruff. Implemented and ready for human QA via PR.
Coordinator integrates and checks all plan acceptance criteria, then runs two fresh blind
reviews against a fixed base/head before opening the PR for human QA. Manual QA follows
the plan. Keep the Kanban item until explicit human acceptance.
