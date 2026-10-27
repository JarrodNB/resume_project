# Rails background jobs

Solid Queue runs Rails background jobs in development and production. Queue tables
live in the primary application database and share its Active Record connection
pool. This lets a domain write and its durable delivery job commit or roll back
together. The Python SQS worker and Rails `ai_results` consumer retain their existing
transports.

## Running and checking jobs

Local Compose starts `api-jobs-worker` from the same image and mounted source as the
API. Native cloud startup starts the `jobs` process after database preparation;
its log is `.native/logs/jobs.log`. Deployments must run `bundle exec ruby bin/jobs`
as a supervised process using the same release, primary database and application
configuration as Rails. The queue scheduler runs the development/production tasks
from `config/recurring.yml`.

New queue tables are installed by the normal application migrations. Do not load
the old standalone `db/queue_schema.rb` into an existing database: its generated
schema uses destructive table creation. Normal application schema dumps now include
the queue tables.

`python3 script/native.py check` verifies the jobs supervisor's recorded process
identity. A live supervisor does not prove successful delivery. For a delivery
problem, inspect its log and `SolidQueue::FailedExecution`, and check that ready and
scheduled jobs are making progress. Solid Queue keeps failed jobs for diagnosis;
arbitrary application failures are not automatically safe to retry.

## Transaction contract

Leave `config.solid_queue.connects_to` unset. Even a new connection declaration
pointing at `primary` creates a separate pool and breaks atomic enqueue. The shared
connection is intentional and covered by real-adapter integration tests.

For jobs that must commit with domain state, explicitly set
`self.enqueue_after_transaction_commit = false`, enqueue inside the domain
transaction, and propagate an enqueue failure so the domain transaction rolls back.
If an enqueue API returns a failed job instead of raising, check that result before
committing. Do not replace this with a best-effort after-commit callback or an
external queue publication.

Existing embedding and account-email jobs deliberately enqueue after commit and
retain their current settings and bounded retry policies. Most specs keep the test
adapter; the queue persistence specs explicitly use the real adapter against the
isolated test database.

## Moving an existing production queue safely

This change does not copy or delete an old separate production queue. Before
deploying it to an installation that has one:

1. Pause job-producing application writes and scheduled producers. Keep the old
   release and its old queue connection available.
2. Drain that queue with the old release. Start its supervisor with
   `SOLID_QUEUE_SKIP_RECURRING=true` so it does not keep creating maintenance jobs.
   Account for ready, scheduled, blocked and claimed jobs. Resolve retained failed
   jobs explicitly; do not discard them to make the queue appear empty. A delayed
   job must be allowed to execute at its intended time or transferred with its
   serialized payload and schedule using a separately reviewed migration.
3. Stop the old workers after no unfinished work remains, and retain a backup of
   their database. Do not let old and new releases accept writes concurrently.
4. Apply normal migrations to the primary database, deploy the new release with
   no separate Solid Queue connection, and start its supervised jobs process.
   Verify queue/domain pool identity and a bounded provider-free delivery check
   before resuming producers.

If the old queue cannot be drained, stop the rollout and prepare an explicit
transfer plan; removing its database or silently changing connections loses work.
Rollback also requires draining/transferring new primary-queue work before restoring
an old release that only reads the separate queue.
