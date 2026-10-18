# AGENTS.md — docs/evals

Human-readable reports from synthetic AI evals.
Generate files here only when the user explicitly requests saved reports. Routine tests
and eval validation should use terminal output; report CLI tests must use temporary directories.

- `README.md` — optional report CLI, model comparisons, estimated costs and failure interpretation.
- Generated `*.md` reports — local timestamped eval artifacts; review before sharing or committing.

Keep fixture data synthetic. Do not add real resumes or secrets. Reports preserve full raw
inputs, outputs, judge reasons and failure stack traces, and may be large.
