# Experience roles and compatibility

An experience preserves one employment block. Its ordered `experience_roles` contain
all titles, start/end dates and optional role descriptions. The entry owns company,
location and an optional overall description. New entries require 1–20 roles. Company
names never establish entry identity: separately presented jobs remain separate entries.
The expansion backfill creates exactly one role per old entry and preserves entry and
highlight IDs, text, dates, order and timestamps. The old flat description introduced its
role: its exact text moves to that role and is cleared from the entry without duplication.
Adding another role later must not make that old intro shared company context.

Highlights remain stable experience-owned rows. A null `experience_role_id` means shared;
a non-null value identifies a role in that same entry, enforced by a composite foreign
key. Removing a role requires explicit removal or reassignment of its bullets. Positions
0–19 are unique per entry with a deferred constraint for swaps and compaction. Each role
and the shared scope support up to 40 bullets; the entry can contain 840 in total.

## Canonical writes and reads

Rails ignores the retained flat `experiences.title/start_date/end_date` database columns.
Current create, update, import and merge paths write only roles. Their historical column
values are untouched recovery evidence and may be stale; they are never authoritative.
The database title column is nullable so new canonical entries leave it empty. Physical
removal is deliberately deferred to a later deployment after the rollback window closes.

`Experiences::SingleRoleCompatibility` adapts legacy request fields into the sole role.
It applies only explicitly supplied fields, including a legacy description as role intro
text. Canonical grouped requests keep their entry description separate. Ambiguous flat writes to grouped entries and
string-bullet replacements over shared evidence are rejected. Read-only model and deprecated
nullable GraphQL title/date projections derive only from a single role; grouped projections
return null. The web app reads roles for every entry. Rails and AI SQL order entries by
their most recent canonical role independently of source role order. Runtime matching,
embeddings, retrieval, screening, gap analysis, tailoring and interview contexts use roles.

Old parse task JSON and saved resume sections are never rewritten. Their deliberate
read/import adapters normalize flat data into a single role when used. This compatibility
does not permit a current database entry to omit its canonical roles. In-flight old parse
results remain importable; task acceptance and queue result application remain idempotent.

## Locking and screening

Text writers lock parent entries in ID order, then reload and row-lock roles and highlights
in ID order before assigning edits. This prevents a recently earned approval from surviving
on changed text because an editor had stale `screened_fields`. Unsaved import sources keep
their in-memory children. Manual merges also hold the owner lock first, as do imports and
frozen interview callbacks. Edits invalidate only changed title/description/content fields;
unchanged checks survive. Reordering or moving a bullet preserves its text approval.

Frozen Basic Interview sources preserve entry IDs, ordered role IDs, each role's dates
and description, and nullable bullet ownership. Company and shared highlights remain at
entry scope. The formatter renders each source once under its entry and role, with no
invented attribution. Exact owned-value callbacks can approve role fields. Existing frozen
snapshots remain readable; an old experience-title source can be screened for that snapshot
without granting a live approval on a different canonical record. Frozen approvals survive
later edits or deletion, while live approval caching still requires the exact current value.

## Deployment and rollback

This transition is not a rolling deployment over pre-role writers. Use this order:

1. Pause library writes and parsing-result acceptance; stop/drain old API and result-worker
   pods and allow their database transactions to finish. Pause queue consumption without
   deleting messages. Take a recoverable database backup. Merely retaining flat columns
   does not make old writers compatible: they can create roleless entries or edit stale flat
   fields after the backfill.
2. Apply the expansion migrations, including one-role-per-entry backfill and scoped bullet
   ownership. Keep separately stored entries separate. If expansion previously ran while
   old pods were still writing, reconcile those late entries from the preserved flat facts
   under the write barrier before continuing. Never overwrite an existing role from stale
   flat columns or regroup by company. The contract migration refuses entries with no roles
   rather than hiding them behind a fallback.
3. Deploy all role-aware Rails API/result workers and AI readers, then apply contract
   retirement before enabling canonical writes. For a single release under the barrier,
   run the complete migrations before starting these binaries. If expansion and contract
   are staged separately, keep the expansion binaries' dual writes only until every consumer
   is migrated; drain them before contract retirement. Run `db:grant_ai_reader_access` through
   the existing migration hooks. Restart workers so no old process retains stale classes.
4. Start the new consumers and resume acceptance/writes. Retained messages and historical
   JSON use the legacy input adapters; do not rewrite queue payloads or saved snapshots.
   Deploy the regenerated GraphQL schema/client together. Old flat clients can edit only
   unambiguous single-role entries and must update to display grouped entries.
5. Rebuild derived library embeddings using the existing `career_library:sync_embeddings`
   task or `CareerLibrary::SyncLibraryEmbeddingsJob`, with the canonical release running.
   Digest checks replace only changed entry/scoped-bullet texts and delete orphan rows.
   This calls the embedding provider and must be an intentional operational run; automated
   verification uses synthetic rows and the fake client, never a paid backfill of real users.

A code rollback must retain a role-aware release and the expanded schema. Once canonical
writes occur, retained flat values cannot reconstruct current history, even for a single
role. Multiple roles, shared bullets and independent entry/role descriptions cannot fit the old schema
losslessly. Contract migration `down` therefore refuses rather than backfilling or deleting
facts. The expansion downgrade likewise rejects lossy states. Restore a pre-transition
backup only with an explicit recovery decision that accounts for all later writes; export
and reconcile grouped data separately if an older application truly must be restored.

## Derived embeddings

Embeddings keep stable Experience and ExperienceHighlight source IDs. Entry text contains
all roles, stated dates and descriptions. Shared bullets name only their company; scoped
bullets name exactly their role and dates. A role edit changes its entry/scoped-bullet digests
without changing a shared bullet's digest or assigning that bullet to a title. Repeated sync
is idempotent and preserves embedding row identity for unchanged source records.
