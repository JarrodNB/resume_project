# 02: Reliable transcripts across failed and concurrent work

**What to build:** Retain observable work through failed calls, fallback, nested screening, concurrent appends, retries and continuation; document usage and cleanup.

**Blocked by:** 01: Grouped local conversation transcripts

**Status:** implemented

- [x] Request/error blocks survive provider failure; unavailable responses are identified truthfully.
- [x] Nested screening, fallback, repeated deliveries and tailoring generations are distinguishable and retained.
- [x] Process-safe appends keep blocks intact under concurrent writers.
- [x] File/format failures preserve original exceptions, queue results, retries and usage accounting.
- [x] Relevant existing regressions pass; developer documentation covers location, opt-out and manual deletion.

## Progress
Branch/worktree, commits, red/green evidence, verification and blockers: pending.

Assigned isolated TDD worker; ticket 01 integrated and independently verified.

Integrated be616565dd1e769ffda3486ab783d1fde08990c8 (worker b877daf). Worker 57 passed; integration full offline suite 398 passed, 9 db deselected. First meaningful red: retained request lacked Provider error block; then green. Multiprocess test: 4 writers, 48 intact 200KB blocks. No implementation blockers.
