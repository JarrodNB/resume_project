# Job Board

Job Board (`/job-board`) lets signed-in users search US-confirmed opportunities by
keyword and an optional remote filter. It starts without a search. Jobs (`/jobs`)
remains the current user's private saved list. Only **Create job** saves a listing;
**Open saved job** opens a match already owned by that user.

## Ownership and provider access

Rails calls CleanJobData's list endpoint through `JobBoard::SearchCleanJobDataService`.
`CLEANJOBDATA_API_KEY` stays in the API environment. Requests include descriptions;
there are no per-listing detail calls. Only structured US country confirmation is
accepted. Unknown countries are excluded, including for remote listings.

`JobBoardListing` is shared across users and unique by provider ID. Later list
responses update its payload without changing personal saved Job snapshots.
`JobBoardSearchPage` stores the exact keyword/filter/cursor page for 24 hours.
`SearchCatalogueService` serializes identical misses with a database advisory lock,
rechecks freshness, and upserts listings before recording a successful page. A failed
refresh returns the last successful page as stale; it never advances its retrieval
time. With no prior page, the operation returns errors without a successful timestamp.

This catalogue is an intentional exception to private owner-scoped domain reads.
GraphQL's saved Job reference is resolved only from `current_user.jobs` through
`SavedJobLookup`; raw provider payloads are not exposed. The AI database role does
not receive access to the catalogue tables.

## Browser contract

`jobBoardSearch(keyword:, remoteOnly:, cursor:)` returns ordered listings, an opaque
continuation cursor, retrieval time, stale status, and errors. The browser requests
only on submit, load more, or retry. Apollo's search cache is bypassed so Rails
controls freshness. Loaded pages retain individual timestamps and stale warnings.
Displayed IDs are deduplicated in first-seen order. A failed page retry preserves
successful pages. A successful earlier-page refresh preserves descendants when its
continuation is unchanged; a changed cursor drops the obsolete descendants.
Request generations prevent old successes or failures replacing a newer search.
Descriptions are text inside remembered collapsed disclosures, never raw HTML.

`importJobBoardListing(input: { listingId: })` delegates to `ImportListingService` and returns
the saved or existing private Job plus field-omission warnings. The UI prevents
concurrent save clicks, invalidates a cached private Jobs list after success, and
opens the returned Job. Warnings travel with that navigation and remain visible
on the matching saved Job page. Import errors keep the search results for retry.

## Private imports

Imports lock the owner and reuse their Job first by catalogue reference, then by
normalized application URL. URL matching drops fragments and recognized tracking
parameters while preserving application paths, meaningful parameters, and repeated
parameter order. The database enforces one Job per user/listing. Another user's
Job is never reused. Existing user edits and application stage are preserved.

New Jobs map provided fields directly and extract bullets only beneath recognized
description headings. There is no LLM classification or automatic AI task on
import. The saved Job can then use the existing gap-analysis and tailoring flows.
Provider licence confirmation remains a commercial-rollout dependency.

## Verification

Colocated page tests exercise the GraphQL boundary, pagination, stale/error retry,
races, import warnings, private-list cache invalidation, and real route guards.
Rails service and GraphQL specs exercise provider HTTP fakes with real catalogue
and owner-scoped persistence. See [testing](../testing.md) for Docker commands.
Visual and responsive review remains a human QA step.
