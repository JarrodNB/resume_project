# Privacy, retention and account data

How long Careergrind keeps each kind of user data, how a user exports or deletes it, and
which outside services receive it. The public wording lives in the web app's privacy policy
(`apps/web/src/features/legal/`); this page is the engineering source of truth. When a
period here changes, change the code, this page and `legalDetails.ts` together.

## Retention policy

| Data | Kept for | Enforced by |
| --- | --- | --- |
| Account, profile, career library, jobs, gap responses, resumes, chats, written interview practice, job preferences | Until the user deletes it or the account | User actions; `Accounts::DeleteAccountService` |
| Uploaded resume files (PDF/DOCX) | 30 days after the parse finishes (completed or failed) | `ResumeImports::PurgeOldUploadsService`, daily via `PurgeOldUploadsJob` |
| Parsed resume result on the AI task | With the account | Account deletion |
| Spoken interview questions, transcripts, feedback and answer recordings | 7 days after the interview starts (`interview_sessions.expires_at`) | `Interviews::CleanupService`, every minute |
| Interviewer speech audio | About 1 hour after the interview ends | `Interviews::CleanupService` |
| Interview media tombstones (random storage keys only) | Until late-write reaping finishes | `Interviews::CleanupService` |
| Never-verified accounts | 7 days | `Accounts::DeleteUnverifiedAccountsService`, hourly |
| Browser sessions | Authentication lasts one day; stale rows are pruned | See [Authentication](authentication.md#cleanup-and-operations) |
| AI usage and cost records | With the account (they belong to its AI tasks) | Account deletion |
| Logfire traces | 30 days | Logfire project retention setting (outside this repo) |
| Database backups | Up to 30 days | S3 lifecycle rule on the nightly `pg_dump` backups (outside this repo) |
| OpenAI API inputs | Up to 30 days for abuse monitoring; not used for training | OpenAI API data policy |

Uploads are kept for 30 days rather than deleted as soon as parsing ends, because SQS can
redeliver a parse message and the worker re-reads the file. After that window the career
library and the task's parsed result hold everything the app uses.

The rows marked "outside this repo" are deployment settings. The
[privacy and legal launch checklist](../operations/privacy-and-legal-launch.md) lists them.

## Account deletion

`DELETE /auth/account` with `{ user: { current_password } }` (session cookie and CSRF
required, throttled per IP and per user like password changes). `Auth::AccountsController`
calls `Accounts::DeleteAccountService`, which locks the user row, checks the password and
runs `user.destroy!`. On success the controller signs the browser out and resets the session.

What the destroy does:

- `dependent:` associations remove the career library, jobs (with gap responses and
  dismissals), resumes, chats, interview practice, job preferences, embeddings, AI tasks
  and their usage records. Foreign keys without a cascade make a missed association fail
  loudly instead of leaving orphans.
- Interview sessions run `Interviews::DetachMediaService` first, which turns their audio rows
  into `delete_pending` tombstones. `Interviews::CleanupJob` deletes the stored objects
  within minutes and retries storage failures.
- Active Storage purges each AI task's uploaded file in the background (`purge_later`).
- Other browsers lose access on their next request: their session rows no longer resolve to
  a user.
- In-flight AI work finds its task or operation gone. `ai_results` messages for a missing
  task are ignored, and internal chat/interview callbacks fail their lookup.

Deletion is immediate and cannot be undone. Copies in backups and traces age out within
30 days. Shared Job Board listings are not user data and are kept.

## Data export

The `accountExport` GraphQL query returns a JSON document built by
`Accounts::ExportAccountDataService`. It reads in one REPEATABLE READ transaction and lists
fields explicitly, so password hashes, sessions, screening receipts, embeddings and AI
bookkeeping are never included. It covers the profile, career library, jobs with gap
responses, resumes with sections, chats, written practice, spoken interviews whose content
has not expired, job preferences and avoided questions. Uploaded files are not included.
The field has a high complexity cost so a request can fetch it only once.

The web app saves the result as `careergrind-export-YYYY-MM-DD.json` without caching it in
Apollo. Bump `FORMAT_VERSION` when the document shape changes incompatibly.

## Who receives user data

| Service | Receives | Why |
| --- | --- | --- |
| OpenAI | Prompt text built from the user's records, interview audio, embedding inputs | Models, transcription, speech, embeddings |
| TypeSafe | User-written text before it enters a prompt | Screening |
| Pydantic Logfire | Traces with prompt and response text; known name, email and phone masked | Debugging and cost tracking |
| AWS | Everything (database, files, queues) | Hosting |
| Cloudflare Turnstile | Browser signals at sign-up | Bot check |
| Email provider | Email address, verification and reset links | Account email |
| CleanJobData | Job search keywords and filters only | Job Board search |

Add a row here and to the privacy policy before sending user data to a new service.
