# Experience roles and compatibility

An experience preserves one source employment block. Its ordered `experience_roles`
contain titles, start/end dates and optional role descriptions. The entry retains the
company, location and overall description. Each old entry backfills to exactly one role;
matching company names do not combine entries. Existing experience/highlight IDs, text,
dates, positions and timestamps survive the migration. The old description stays on the
entry, without copying it into the role.

Highlights remain experience-owned stable rows. `experience_role_id = NULL` means shared;
a non-null value scopes the bullet to a role in that same entry. A composite foreign key
prevents cross-entry ownership. Deleting a role with bullets requires explicit reassignment or removal first.
Deleting the entry deletes its bullets before its roles. The foreign key is
initially deferred to permit transactional ownership changes and parent cleanup.

Roles use positions 0–19, with a unique position per entry. This bounds entries to 20 roles
in both PostgreSQL and Rails. Titles/descriptions use the existing short/prose caps. The
existing total-entry bullet cap remains unchanged during this expansion.

During consumer migration, the flat title/date columns are compatibility projections.
`Experiences::SingleRoleCompatibility.prepare!` applies only explicitly edited flat
fields to the canonical role and refreshes the flat projection. Create, update, import,
merge and highlight-move paths preserve the single-role contract. GraphQL returns roles
and optional bullet ownership and projects legacy fields from the first ordered role,
falling back to flat columns only for pre-expansion/unsaved legacy records. Flat writes,
merges and moves reject grouped entries until their grouped editor is available; this
stage adds no production grouped-write interface. Application code must use the service
write interfaces rather than updating compatibility columns directly.

The migration downgrade is allowed only while each entry still has one role matching its
flat fields and no role description or shared bullets would be lost. Otherwise it raises
with reconciliation guidance. Export/reconcile new grouped data before rolling back;
downgrading must never silently drop role information.

The AI reader keeps one ordered highlight list per experience, carrying nullable
`experience_role_id` on each bullet, and reads ordered child roles within the same
user-scoped snapshot. Nested title/description checks report `experience_role` with
the role ID; Rails accepts only the owner's allowlisted fields. Single-role legacy
edits invalidate the changed canonical role fields. Temporary flat Python fixtures
normalize to an identity-free role and keep checks on the legacy experience, so a
synthetic role never receives a durable approval.

Embeddings retain the existing Experience and ExperienceHighlight source IDs.
The experience text includes each role's title, stated dates, and description.
Shared bullets carry company context only; scoped bullets carry exactly their role's
context. Editing a role changes its entry/scoped-bullet digests without changing a
shared bullet's digest or assigning that achievement to a particular title.
