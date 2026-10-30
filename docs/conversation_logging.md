# Local conversation transcripts
Description: Reading and cleaning up local development AI exchanges.
Index: location, contents, controls, failures and cleanup.

Docker Compose and the native cloud launcher set the AI worker to local mode,
which enables transcripts by default. Open
`services/ai/conversation_logs/<user UUID>/` in your editor. Files are Markdown
plain text and are ignored by Git.
The local AI container runs as UID/GID 1000 so generated reports and transcripts
belong to the desktop user. If your host IDs differ, set `LOCAL_UID` and `LOCAL_GID`
when running Docker Compose (check them with `id -u` and `id -g`).

Every AI task uses `task-<AI task UUID>.md`, including separate tasks for the same
job, question set or task type. Redeliveries of that task append to its existing
file. Older `job-` and `question_set-` files stay untouched; a redelivered
historical task starts a task file rather than modifying its old grouped file.

Attempt headings say `INITIAL ATTEMPT — delivery 1` or
`RETRY / REDELIVERY — delivery 2` (with the actual delivery count). Each includes
task ID, receive count, timestamps and an attempt UUID. Redelivery can follow a
temporary task failure, interruption or publication failure; it does not prove
the model request itself failed.
Historical transcripts may include a generation value from the former tailoring
approval flow; current tasks carry no generation counter. The logger still renders
that optional metadata for reading older exchanges. Each concrete model request has its own UUID. Request snapshots
repeat the full model history deliberately: repeated text in later snapshots
does not mean a new user message. Models identify nested screening and fallback
calls. Function tools, structured output tools and validation retries have
separate labels. Requests contain the model-visible contact placeholders;
responses are recorded before contact restoration.
System instructions remain readable text. Request parameter dumps, tool definitions,
and output JSON schemas are omitted to keep exchanges easy to read.

`VALIDATION FAILURE / RETRY` marks newly observed validation feedback. The heading
includes the run, concrete request and model identity; feedback stays readable below
it. `VALIDATION EXHAUSTED` marks the terminal rejection, including when no further
provider request is made. Full request snapshots still repeat earlier feedback under
the ordinary `Validation retry` label; those repetitions are not new failure events.
Validation feedback is masked again because validators can see restored contact text.

`PROVIDER FAILURE` keeps its concrete request/model identity and error type. Exception messages are
omitted because provider errors can include arbitrary private payloads. No
partial response is invented when the provider supplies no response object.
Hidden reasoning and unexposed network data are unavailable.

`FALLBACK EXECUTION` marks entry into an explicitly configured generative or
screening fallback. It includes the source/destination models, a unique fallback
execution ID, and the enclosing agent run ID when available. Screening can run
outside an agent run, so its run identity may be unavailable. These events mark
execution, not success: the following response, validation or provider failure
shows what happened. Model changes and adjacent requests alone never imply fallback.

Outcomes distinguish published results, retries with published usage, and
publication failures. `RETRY PENDING` marks successfully published end-of-attempt
usage before another task delivery. `PUBLICATION FAILURE` marks a failed queue
publication and names the result status and error type, without the error payload.
A started attempt with no recorded outcome may have been
interrupted or encountered a logging failure. Concurrent workers lock each
append block, so their blocks can alternate but never merge. Match attempt and
request IDs to follow a call.
Complete-draft tailoring also runs independent requests concurrently within one
attempt. A request snapshot may therefore appear before another request's response;
this ordering alone does not mean a retry. Use request IDs to pair them.

To disable logging locally, set `CONVERSATION_LOGGING_ENABLED=false` in
`services/ai/.env` and recreate the Compose AI worker or restart the native stack.
In native cloud, an inherited environment variable takes precedence over the `.env` value.
Logging requires `WORKER_ENVIRONMENT=local`; other environments remain disabled even when the
logging setting is true. A Logfire environment label does not enable it. Production uses tracing only;
transcript settings do not disable or reconfigure Logfire instrumentation.

Logs stay across worker restarts. Delete individual Markdown files, a user's
directory, or the entire `services/ai/conversation_logs/` directory manually
when finished. Stop the worker before deleting logs to avoid deleting a file
while it is being appended. There is no automatic cleanup. Transcripts contain
the full model-visible user content, so keep them local.

Disk, formatting and locking failures emit a short diagnostic and leave model
results, original exceptions, accounting and queue delivery unchanged.
