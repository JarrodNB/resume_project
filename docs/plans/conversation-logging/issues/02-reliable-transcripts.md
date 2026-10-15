# 02: Reliable transcripts across failed and concurrent work

**What to build:** Retain observable work through failed calls, fallback, nested screening, concurrent appends, retries and continuation; document usage and cleanup.

**Blocked by:** 01: Grouped local conversation transcripts

**Status:** ready-for-agent

- [ ] Request/error blocks survive provider failure; unavailable responses are identified truthfully.
- [ ] Nested screening, fallback, repeated deliveries and tailoring generations are distinguishable and retained.
- [ ] Process-safe appends keep blocks intact under concurrent writers.
- [ ] File/format failures preserve original exceptions, queue results, retries and usage accounting.
- [ ] Relevant existing regressions pass; developer documentation covers location, opt-out and manual deletion.

## Progress
Branch/worktree, commits, red/green evidence, verification and blockers: pending.
