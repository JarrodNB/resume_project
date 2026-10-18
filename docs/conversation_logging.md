# Local conversation transcripts
Description: Reading and cleaning up local development AI exchanges.
Index: location, contents, controls, failures and cleanup.

Docker Compose enables transcripts automatically for the AI worker. Open
`services/ai/conversation_logs/<user UUID>/` in your editor. Files are Markdown
plain text and are ignored by Git.
The local AI container runs as UID/GID 1000 so generated reports and transcripts
belong to the desktop user. If your host IDs differ, set `LOCAL_UID` and `LOCAL_GID`
when running Docker Compose (check them with `id -u` and `id -g`).

Analysis and tailoring share `job-<job UUID>.md`. Interview generation,
replacement and feedback share `question_set-<set UUID>.md`. Imports use
`task-<task UUID>.md`; tasks without a valid grouping ID also use their task ID.
Import logs are not linked to a job created later.

Each attempt includes task ID, receive count, generation, timestamps and an
attempt UUID. Each concrete model request has its own UUID. Request snapshots
repeat the full model history deliberately: repeated text in later snapshots
does not mean a new user message. Models identify nested screening and fallback
calls. Function tools, structured output tools and validation retries have
separate labels. Requests contain the model-visible contact placeholders;
responses are recorded before contact restoration.
System instructions remain readable text. Request parameter dumps, tool definitions,
and output JSON schemas are omitted to keep exchanges easy to read.

A provider failure keeps its request and error type. Exception messages are
omitted because provider errors can include arbitrary private payloads. No
partial response is invented when the provider supplies no response object.
Hidden reasoning and unexposed network data are unavailable.

Outcomes distinguish published results, retries with published usage, and
publication failures. A started attempt with no recorded outcome may have been
interrupted or encountered a logging failure. Concurrent workers lock each
append block, so their blocks can alternate but never merge. Match attempt and
request IDs to follow a call.

To disable logging locally, set `CONVERSATION_LOGGING_ENABLED=false` in
`services/ai/.env` and recreate the AI worker. Logging requires
`WORKER_ENVIRONMENT=local`; other environments remain disabled even when the
logging setting is true. A Logfire environment label does not enable it.

Logs stay across worker restarts. Delete individual Markdown files, a user's
directory, or the entire `services/ai/conversation_logs/` directory manually
when finished. Stop the worker before deleting logs to avoid deleting a file
while it is being appended. There is no automatic cleanup. Transcripts contain
the full model-visible user content, so keep them local.

Disk, formatting and locking failures emit a short diagnostic and leave model
results, original exceptions, accounting and queue delivery unchanged.
