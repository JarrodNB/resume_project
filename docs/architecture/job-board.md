# Job Board

Job Board (the Find jobs tab at `/jobs/find`) lets signed-in users search US-confirmed opportunities by
keyword, date posted (24 hours, 7 days, or 30 days), a resolved US city or state,
employment types, remote arrangement, company name, minimum salary, and experience
levels (Entry, Mid, Senior, Executive). Newest is the default order; Most relevant
uses provider relevance. Company and salary live in a remembered More filters
disclosure. People may select multiple levels; leaving them all blank omits
the provider filter, including jobs with unspecified experience. Selecting all four
is an explicit filter and remains distinct from leaving the selection blank.
It starts without a search. Jobs (`/jobs`)
remains the current user's private saved list. Only **Create job** saves a listing;
**Open saved job** opens a match already owned by that user.

## Ownership and provider access

Rails calls CleanJobData's list endpoint through `JobBoard::SearchCleanJobDataService`.
`CLEANJOBDATA_API_KEY` stays in the API environment. Requests include descriptions;
there are no per-listing detail calls. Only structured US country confirmation is
accepted. Unknown countries are excluded, including for remote listings.

`JobBoardListing` is shared across users and unique by provider ID. Later list
responses update its payload without changing personal saved Job snapshots.
`SearchCatalogueService` trims keywords, collapses repeated spaces, and lowercases
letters before provider requests and page locking; punctuation and quote characters
are preserved. The browser keeps the entered text. `JobBoardSearchPage` caches this
canonical keyword/filter/sort/cursor page for 24 hours, or 15 minutes when a date
posted window is selected so short-window results do not remain cached for a full day.
Case variants share first and
continuation pages; opaque cursor case, remote-only filters, and different
experience-level selections
remain distinct. Selected experience levels are validated provider codes (`EN`, `MI`,
`SE`, `EX`) and canonicalized as a deduplicated set before provider calls, cache keys,
and advisory locks. The provider receives a comma-separated `experience_level` filter;
no level is inferred from a career library and reranking does not set it.
Any arrangement omits the provider remote filter. Any remote option uses `remote=true`,
which can include hybrid roles. Fully remote, Hybrid, and country/region-restricted
options additionally send `remote_type`; this describes the provider classification,
not a guarantee of location eligibility. The board still enforces US confirmation.

`SearchFilters` validates optional inputs before HTTP or cache access. It canonicalizes
employment selections as a set and company whitespace/casing, removes empty/default
preferences, and includes every effective filter and sort in page identity. City and
state IDs are mutually exclusive. Minimum salary uses the provider's `salary` lower
bound; excluding undisclosed values sends `require_salary=true`. The UI does not
assume annual USD or convert hourly values: users should check currency and pay period
in the listing. Employment, salary text/currency, remote type, and valid posting dates
are displayed when supplied; missing values remain unknown.

`jobBoardLocations(query:)` calls the fixed `/geo/suggest` endpoint only when Find
locations is clicked. This authenticated server boundary accepts a bounded query,
requests city/state suggestions, and returns only validated US labels, kinds, and IDs.
It uses a five-second deadline and safe retryable errors without returning provider
payloads or credentials. The selected kind determines the city/state search parameter;
typed but unresolved locations block search until selected or cleared. Editing location
text invalidates pending suggestions. Location lookup does not populate the job cache.

The shared search-page identity includes a normalization revision, so older pages cannot hide
changed provider handling; old pages are bypassed rather than used as stale fallback.
`SearchCatalogueService` serializes identical misses with a database advisory lock,
rechecks freshness, and upserts listings before recording a successful page. A failed
refresh returns the last successful page as stale; it never advances its retrieval
time. With no prior page, the operation returns errors without a successful timestamp.

This catalogue is an intentional exception to private owner-scoped domain reads.
GraphQL's saved Job reference is resolved only from `current_user.jobs` through
`SavedJobLookup`; raw provider payloads are not exposed. The AI database role does
not receive access to the catalogue tables.

## Browser contract

`jobBoardSearch(keyword:, remoteOnly:, experienceLevels:, filters:, cursor:)` returns ordered listings, an opaque
continuation cursor, retrieval time, stale status, and errors. The browser requests
only on submit, load more, or retry. All provider controls are draft
filters until submit; displayed result context and all continuation/retry requests use
the submitted snapshot even if the form changes. Apollo's search cache is bypassed
so Rails
controls freshness. Loaded pages retain individual timestamps and stale warnings.
`useJobBoardSearch` owns that submitted snapshot, its provider pages, and optional
ranking coordination. The page supplies a form snapshot and ranking preference,
then reads submitted context and displayed listings together. Each submission or
accepted provider page creates a new snapshot identity, including refreshes with
unchanged listing IDs; ranking uses that identity directly. Form drafts and the
Hide already saved preference do not change ranking candidates or identity.
Displayed IDs are deduplicated in first-seen order. A failed page retry preserves
successful pages. A successful earlier-page refresh preserves descendants when its
continuation is unchanged; a changed cursor drops the obsolete descendants.
Request generations prevent old successes or failures replacing a newer search.
Descriptions are text inside remembered collapsed disclosures, never raw HTML.
Hide already saved immediately filters loaded results by the owner-scoped `savedJob`
reference, after optional career-library ordering. It does not change provider requests,
shared pages, or reranking candidates. Counts distinguish shown, loaded, and hidden rows;
an all-hidden page keeps Load more available and explains how to reveal saved results.

`importJobBoardListing(input: { listingId: })` delegates to `ImportListingService` and returns
the saved or existing private Job plus field-omission warnings. The UI prevents
concurrent save clicks, invalidates a cached private Jobs list after success, and
opens the returned Job. Warnings travel with that navigation and remain visible
on the matching saved Job's workspace. Import errors keep the search results for retry.

## Next-job preference profile

Find jobs includes a remembered, initially collapsed “What I want next” section. The owner
can save up to 10 criteria (500 characters each), with `must_have` or `nice_to_have`
priorities. Saving a draft does not activate it: confirmation copies the saved draft to the
confirmed snapshot. The confirmed summary is reusable on later searches. An empty confirmed
summary leaves preference checking disabled. This profile describes the desired job, separate
from career-library relevance or qualifications.

`jobPreferences` reads the current owner's `JobPreferenceProfile`, or an empty version-0
state without a database write. `saveJobPreferenceDraft`, `confirmJobPreferences`, and
`clearJobPreferences` require the exact last-read `expectedVersion`; all writes take the
owner lock and advance a monotonic version. Confirmation separately advances
`confirmedRevision`. Criterion IDs are generated by Rails and retained across edits; supplied
IDs must already belong to the owner's current draft or confirmed snapshot. A stale editor
cannot overwrite newer work or confirm a draft it has not seen.

Clear removes both snapshots' preference text and retains only the revision fence, so an old
version-0 request cannot resurrect cleared preferences. Profiles have no AI reader grant and
never enter shared listing payloads or private saved Jobs. Editing preferences makes no
provider/model calls. Browser drafts are saved explicitly; failed writes preserve local edits
and offer an explicit reload of the latest saved state.

## Preference conversation

“What I want next” also offers a focused conversation. `startJobPreferenceConversation`
queues `elicit_job_preferences` through the normal general allowance and SQS lifecycle;
it does not extend generic Chat or change its HTTP execution contract. The configured
`CHAT_MODEL` and generative fallback draft preferences. One Pydantic AI deferred `ask_user`
question can pause each turn. Up to 12 linked turns, 4,000 input characters per turn,
120,000 input bytes, and 100,000 history bytes bound the exchange.

Rails resolves previous task IDs through the owner, freezes the profile version and
current draft, and stores model history privately. `jobPreferenceConversation` returns
only accepted public user/assistant text, latest task state and a stale warning. Public
task input excludes raw history. Matching duplicate submissions reuse a child; different
answers cannot overwrite it. Accepted paused/completed turns cannot be replaced by a
redelivery, while attempt accounting still accepts late usage independently.

Validated completion saves an editable draft and increments its version atomically;
it never confirms preferences. Changed/cleared/confirmed profiles and superseding turns
fence late output. New conversations can start after a clear even while obsolete work
finishes. Unsaved manual edits must be saved before sending a message; the local editor
pauses during its current conversation request. Cross-tab edits are protected by the
same server revision fence. Failed messages remain available for retry after reopening.

The worker screens new user text and unknown draft criteria. Exact criteria from accepted
turn inputs or generated proposals reuse server-owned provenance; generated questions and
validated saved history are not screened again. Readable labeled text, the official input
guardrail, contact masking, prompt version `job-preference-conversation-v1`, tracing and
per-attempt accounting remain active. Deferred question IDs and text must match saved tool
calls before Rails permits continuation.

Synthetic evaluation uses three cases for stated priorities, one real clarification,
and salary units. This small deterministic sample does not establish broad intent fidelity;
human QA should check that eligibility context is not turned into an unintended constraint.

## Optional hybrid reranking

The default-off browser toggle requests an asynchronous rerank of currently loaded
candidates. It does not change the search provider's keyword, remote, or selected
experience-level filters and does not infer a user's seniority. Turning it off restores
provider order. New searches and loaded pages have their own candidate snapshot; an old
ranking cannot reorder a newer set. Ranking is limited to 100 loaded candidates.

`rerankJobBoardListings(input: {keyword:, listingIds:})` reads only those shared catalogue
IDs, captures their title/plain-description excerpts, and queues `rerank_job_listings`.
The user cannot submit arbitrary descriptions. Excerpts use a 140,000-byte combined text
budget, at most 6,000 UTF-8 bytes per listing; complete input must fit 200,000 UTF-8 bytes.
Normal AI admission and cost accounting apply. Identical recent queued work is reused.
A missing current-model career-library index returns a clear error instead of queueing.

The worker receives `{keyword, listings: [{id, text}]}`, embeds listing text in a batch,
and compares it with the task owner's existing career-library embeddings. Equal-weight
reciprocal rank fusion (k=60) combines mean top-three cosine similarity order with BM25
on the submitted keyword. Only the existing user/model-scoped library index is read;
the AI role still has no access to catalogue tables. There is no generative LLM call or
qualification percentage. Empty/unavailable evidence or provider failure preserves the
browser's provider-order fallback with a retryable error.

The worker returns `{ranked_listing_ids: [...]}`. Rails accepts only an exact permutation
of the queued IDs, applies ordinary task completion/duplicate-result rules, and updates
subscribers. Task input and results remain private to the task owner; reranking never
saves private Jobs or changes the shared search-page order. This is an optional discovery
experiment, not a validated prediction of qualification or hiring outcomes.

## Private imports

Imports lock the owner and reuse their Job first by catalogue reference, then by
normalized application URL. URL matching drops fragments and recognized tracking
parameters while preserving application paths, meaningful parameters, and repeated
parameter order. The database enforces one Job per user/listing. Another user's
Job is never reused. Existing user edits and application stage are preserved.

`ListingLocation` selects usable confirmed US display labels, otherwise city, state
(code preferred over name), and US. Labels are deduplicated in provider order. When
only country-level structure exists, original provider location text is the fallback,
then US. Malformed optional fields are ignored. The provider and new imports use the
same rule, including new imports of older catalogue snapshots. Existing saved Jobs,
including blank locations, are never backfilled or changed by a repeat import.

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
