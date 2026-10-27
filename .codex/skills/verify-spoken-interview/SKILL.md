---
name: verify-spoken-interview
description: Select and run Careergrind spoken interview offline, process-recovery, or real-provider verification using existing harnesses and the correct retained ledger policy. Use for spoken interview verification, not written interview evals, general PR environment setup, or ordinary output-quality comparisons.
---

# Verify spoken interviews

Match the evidence to the requested claim. Follow applicable `AGENTS.md` files,
[execution environment guidance](../cloud-runtime.md), and the current
[real QA guide](../../../docs/interview-real-qa.md). Read
[session architecture](../../../docs/architecture/interview-sessions.md) and
[provider accounting](../../../docs/architecture/interview-provider-accounting.md) when the
verification touches execution or usage. Do not infer today's runtime state or permission
from historical verification records.

## Select the verification path

| Requested evidence | Existing path | What it establishes |
| --- | --- | --- |
| Contract or implementation regression | Focused Rails/Python/frontend tests in [testing guidance](../../../docs/testing.md) | Ownership, state transitions, validation, rendering, and mocked failures |
| Current full-flow process recovery | [Full-session harness](../../../script/interview_full_session_check.sh) and [offline guide](../../../docs/interview-recovery.md) | Real local services with synthetic provider HTTP, process interruptions, accepted-result replay, speech recovery, and storage handling |
| Legacy fixture/lease recovery | [Recovery harness](../../../script/interview_recovery_check.sh) | Its scripted fixture flow and recovery assertions; not current live interview quality |
| Actual provider smoke or human device QA | [Real QA launcher](../../../script/interview_real_qa.sh) and real QA guide | Only the provider samples or browser/device observations actually performed |
| Conservative bounded paid diagnostic | [Paid-check driver](../../../script/interview_paid_check.sh) and its [Rails entrypoint](../../../services/api/script/interview_paid_check.rb) | The driver's bounded live checks with its stricter failure/unknown-cost stop policy |

Use the smallest path that answers the question. Inspect the current script and Compose
overlays before execution; historical docs may name a retained worktree. Resolve the actual
target checkout and use its absolute script path instead of copying a stale machine path.

## Prepare without changing the wrong environment

- Inspect existing projects, mounts, images/dependencies, browser origins, and retained
  volumes. Do not run the same fixed project from two checkouts simultaneously. Keep synthetic
  harness projects separate from real QA and other development stacks.
- Offline process harnesses use their own synthetic credentials/provider transports and
  preserve diagnostic volumes. Do not add real environment files or start paid providers
  to resolve an offline setup problem. In managed cloud, use supported native checks and
  disclose local Docker harness coverage that is unavailable; do not claim an equivalent run.
- Real local QA uses the one retained paid database named by the current guide, the original
  ignored AI environment file, configured telemetry, private storage, and internal service
  credentials. Never print/copy secret values into artifacts. The same browser stack also
  needs SQS and both queue workers for resume uploads and other queued features.
- Starting real execution may immediately resume pending work and incur charges. Stay within
  the requested/previously authorized provider scope. If missing authorization matters,
  prepare the exact path, pending-work implications, and bounded plan before asking once.
  Do not add obsolete paid-approval flags or ask again for already authorized local QA.

## Preserve the selected accounting policy

- Current development QA permits local paid testing without enforcing the verification
  spend/unknown-cost or interview monthly/hourly gates. Costs and unknowns remain recorded;
  concurrency, submission, deadline, and execution caps still apply. Do not extend this
  development behavior to other environments or general AI allowances.
- The conservative paid-check driver still stops on failed operations or unknown usage and
  stops its runtime on exit. Preserve that policy when choosing that driver; do not rewrite
  it to imitate browser QA. Conversely, do not impose its stop rule on normal local QA.
- A reservation/estimate is not a provider hold, invoice charge, or bill ceiling. Preserve
  the original observations and report known charges separately from unknowns. Never delete
  ledger rows, reset volumes, fabricate zeroes, or create a new paid database to continue.
  Reconciliation needs reliable evidence and the established scoped path.
- Recovery must retain accepted dialogue and identities. Speech-only retry uses saved text;
  it must not repeat transcription or reasoning. Respect lease/fencing and bounded recovery
  rather than manually resubmitting pending operations.

## Report the actual evidence

Record checkout/revision, selected harness/project, commands, observed assertions and failures,
available ledger changes, and remaining gaps. Preserve failed fixtures for diagnosis and
report retained resources. Let harness-owned cleanup run; keep an authorized QA runtime
running when requested and provide its supported status/stop commands without deleting data.

Separate offline engineering evidence, actual provider samples, and human microphone,
playback, dictation, and browser observations. Offline scores do not establish relevance or
speech quality; emulator storage does not prove production signed-URL/IAM enforcement.
Paid interview quality datasets/judges remain deferred under the documented exception.
Do not claim a full session passed after only an opening or partial progression succeeded.
