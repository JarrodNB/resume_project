# AGENTS.md — conversation_logging

Local development Markdown transcripts. Keep capture independent of accounting and task behavior.

- `__init__.py`: task scope, per-user/task files, visible delivery/outcome headings, nonfatal process-locked appends, concrete request/error capture, and queue publication outcomes. `ConversationLogging` uses supported agent capability hooks to observe new validation feedback and exhaustion with per-run identities; repeated history is not a fresh event.
- `render.py`: complete message parts and instruction text with readable labels; omit request parameter and schema dumps.

Follow parent Python header/docstring rules. Never restore contact text. Logging failures must
not replace provider results or exceptions. Telemetry labels never enable transcripts.
Validation observation reuses the privacy boundary's outbound masking because validators
can receive restored contact text. It never restores text or changes retry policy.
