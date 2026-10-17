# 01: Grouped local conversation transcripts

**What to build:** Dedicated logging module and minimal task/model hooks produce full model-visible Markdown exchanges in local development, grouped by user and saved job, interview question set, or import task.

**Blocked by:** None

**Status:** implemented

- [x] Local Compose enables logging automatically; explicit opt-out and nonlocal environment produce no artifacts.
- [x] Readable system/user/assistant/tool/retry/structured output content, model and attempt identities are captured.
- [x] Model-visible masked requests and responses before restoration; existing handlers and return contracts unchanged.
- [x] Git-ignored host-visible files, validated UUID grouping, nonfatal write errors.
- [x] Meaningful synthetic-model and task-path TDD evidence; required indexes updated.

## Progress
Assigned TDD subagent implement_grouped_transcripts. Branch work/conversation-logging-01-grouped-transcripts; worktree /tmp/careergrind-conversation-logging-01. Commits and red/green evidence pending.

Integrated commit: 90ecfe8 (worker 4958ea5). Orchestrator independently ran Docker acceptance/affected regressions: 46 passed. Worker also ran tracing: 6 passed; Ruff and diff checks passed. Red evidence: missing transcript, then unreadable escaped tool arguments.
