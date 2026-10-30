# Job Board

Job Board (the Find jobs tab at `/jobs/find`) lets signed-in users search US-confirmed opportunities by
keyword, date posted (24 hours, 7 days, or 30 days), a resolved US city or state,
employment types, remote arrangement, company name, minimum salary, and experience
levels (Entry, Mid, Senior, Executive). Newest is the default order; Most relevant
uses provider relevance. Company and salary live in a remembered More filters
disclosure. People may select multiple levels; leaving them all blank omits
the provider filter, including jobs with unspecified experience. Selecting all four
is an explicit filter and remains distinct from leaving the selection blank.
A bare Find jobs URL starts without a search. Jobs (`/jobs`)
remains the current user's private saved list. Only **Save job** saves a listing;
**Open saved job** opens a match already owned by that user.

Before a submitted search, chips show the signed-in user's saved job-title suggestions from
confirmed resume imports. They come from `me.jobTitleSuggestions`, fetched when the board
opens so a later accepted import is reflected. Missing or unavailable suggestions retain the
three default examples. Clicking a chip fills and focuses the keyword without submitting or
changing filters. Manual-only users keep defaults until they confirm an import. Clearing the
career library also clears these imported suggestions, returning the board to defaults.

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

The browser requests `jobBoardLocations(query:)` when the user clicks Find locations or
presses Enter in the location field with at least two characters and no selected location.
The authenticated server boundary calls the fixed `/geo/suggest` endpoint, accepts a bounded query,
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
on submitted searches (including validated URL visits), load more, or retry. All provider controls are draft
filters until submit; displayed result context and all continuation/retry requests use
the submitted snapshot even if the form changes. Apollo's search cache is bypassed
so Rails
controls freshness. Loaded pages retain individual timestamps and stale warnings.
Submitted keywords, filters and sort live in the URL. Bounded parsing rejects invalid
keywords and drops unsupported filter values before requests; location labels are display
text and only validated numeric city/state identities reach the provider. Refresh or a
copied URL reruns the search from page 1. Back/Forward restores the corresponding search.
Applied filter chips remove one submitted choice and immediately submit the remaining
choices, synchronizing the form without applying unrelated drafts. Clear filters retains
the submitted keyword and restores default filters and sort.

`useJobBoardVisit` keeps up to five recent searches in memory for the current Apollo
session client. Inactive visits with more than 200 provider rows are discarded. Returning
from a saved Job restores retained loaded pages, selected page, scroll, save feedback,
retry state and display preferences. Explicitly submitting a search starts at page 1 even
when that URL has a retained visit. Nothing is persisted to browser storage; account/client
replacement discards access to the prior session's visits and resets private preferences.
Pending search, save, career ranking and preference-check completions update their original
visit while away. Returning restores the selected result order, reuses completed outcomes
or reconnects to queued work without re-enqueueing. Preference checks still require the
same snapshot and confirmed profile revision. A newly submitted search starts in search
order and requires explicit actions for either kind of ranking.

`jobBoardVisit` owns submitted search execution, ranking records, save locks and feedback,
and result-page selection for each visit. Its actions keep request generations, pending
flags and ranking maps private; callers cannot patch visit state. Its
`jobBoardPreferenceCheck` owner retains explicit batch requests and evidence behind
check, receive and read actions, with the same snapshot/revision fences. The React
`useJobBoardVisit` hook selects and subscribes to retained visits, while
`useJobBoardReranking` connects the current queued task to live updates;
`useBoardPreferenceCheck` observes confirmed revisions and connects the preference task;
both hooks handle disconnected subscriptions. Disconnected career-ranking and preference-check subscriptions
offer an explicit reconnect to their existing queued task without creating another paid task. The page owns URL navigation, drafts and
scroll effects. It submits a form snapshot, then reads submitted context and displayed
listings together. Each submission or
accepted provider page creates a new snapshot identity, including refreshes with
unchanged listing IDs; ranking uses that identity directly. Form drafts and the
Hide already saved preference do not change ranking candidates or identity.
Displayed IDs are deduplicated in first-seen order. A failed page retry preserves
successful pages. A successful earlier-page refresh preserves descendants when its
continuation is unchanged; a changed cursor drops the obsolete descendants.
Request generations prevent old successes or failures replacing a newer search.
Listing titles open an accessible preview dialog: a right-side panel on desktop and a full-screen panel on phones. Closing it or pressing Escape returns focus to the title while the list and its scroll position stay in place. The preview uses the already loaded listing; it starts no detail request or public route. Descriptions are plain text, never raw HTML. Short
"Label:" lines and "- " bullets are shown as labels and lists; the text itself is not parsed as markup.
Hide already saved immediately filters loaded results by the owner-scoped `savedJob`
reference, after optional career-library ordering. It does not change provider requests,
shared pages, or reranking candidates. Counts distinguish shown, loaded, and hidden rows;
an all-hidden page keeps Load more available and explains how to reveal saved results.

`importJobBoardListing(input: { listingId: })` delegates to `ImportListingService` and returns
the saved or existing private Job plus field-omission warnings. The UI prevents
concurrent save clicks, invalidates a cached private Jobs list after success, and
keeps the listing in place with an Open saved job action. Both the row and preview share the visit save lock and feedback. Errors and field-omission warnings are visible inside an open preview. A View original posting link is available only for an absolute HTTP(S) application URL without embedded credentials. Warnings travel with saved-job navigation and remain visible
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

Preference conversation generation is retired. Existing drafts, confirmed criteria and
historical task/usage records remain. Its GraphQL conversation operations and AI handler
are removed; legacy queue bodies still decode and return an unsupported-task failure
without model calls. Late successful generation results are failed without changing the
profile, and historical task inputs continue to hide private model history.

## Explicit preference checks with JEV

Each search listing exposes `preferenceSourceDigest`, a SHA-256 of readable title,
company, location, remote classification/option, employment, salary/currency and
plain description. `checkJobBoardPreferenceResults(listings: [{listingId:, expectedDigest:}],
confirmedRevision:)` queues one assessment for 1–100 loaded listings in their provider order. Rails rejects changed content,
missing confirmation and stale profile revisions before enqueueing. The browser
never supplies trusted posting text. Checks create no private Job.

`check_job_preferences` stores the owner profile/revision, criterion identities, priorities
and text fingerprints, plus listing identities, source/passage fingerprints and truncation
flags. It stores no criteria text or listing passages. Python reads the owned queued command,
current confirmed profile and selected shared catalogue rows in one repeatable read; changed
revisions or fingerprints fail before model work. Retained legacy copies are comparison
fences only, never source authority. The transient source
excerpt is at most 8,000 UTF-8 bytes per listing and shares a 100,000-byte source
budget across the batch. Each passage is at most 500 characters, with at most 64
passages per listing; smaller per-listing budgets also reduce the passage count so
short-line metadata stays bounded. Omitted bytes or passages set the truncation flag.
The hydrated input must fit 180,000 UTF-8 bytes. A conservative result-size preflight
bounds identity/probability result size before paid work, even below the 100-listing limit. A normal
20-listing page with all ten criteria is covered by a boundary regression. The worker has column grants for catalogue ID/payload/screening receipts and confirmed
profile identity/revision/criteria/receipts; drafts, provider IDs, search pages and writes
remain denied. A nonmaterialized security-barrier view exposes only owner/text pairs from
completed historical generated criteria; command flags cannot establish provenance.
Shared pages contain no private results.

The JEV preference agent builds one dynamic Pydantic output field per confirmed
preference, from one to ten: `p1` through `p10`, each a finite float bounded to `[0, 1]`.
Fields map back to the selected criterion UUIDs in code. Pydantic AI maps bounded floats
to Jev's native `Noul` probability primitive, returning raw probabilities rather than
thresholding booleans or converting confidence margins. These are independent questions:
several preferences may all score highly and their values need not sum to one. Neither
passage IDs nor `none` are offered as model choices; input passage segmentation remains
only a source-size/provenance boundary, and the prompt renders posting text without IDs.

The result for a criterion is exactly `{id, probability}`. No source citation, evidence
quote, status or reason is generated. Explicit support raises fit estimates and explicit
contradictions lower them; omitted, partial or ambiguous details leave uncertainty.
The percentages are model estimates from limited posting text, not calibrated real-world
likelihoods or verified facts. In particular, missing-source estimates may be low rather
than centered at 0.5. Provider failure remains a failed check, never a fabricated score.

Preference criteria and listing passages are treated as data without prompt-injection
classification. Fixed labeled source blocks, a bounded input guard, contact masking,
versioned prompts, Logfire traces and normal worker attempt accounting apply. The model
returns only bounded numeric estimates, with no evidence prose. This avoids categorical
source-selection mistakes but leaves the model exposed to instructions embedded in listing text.
No screening approvals are granted by a preference check.

A shared actual-request budget stops at 240 provider requests or 600,000 consumed tokens.
Each listing has a fresh one-request JEV run;
runs never reuse a cumulative per-agent usage counter. Up to four decision runs execute
concurrently, preserve source order, and cancel/await sibling work on failure. All work
shares the existing 240-second task deadline; each matching request additionally has a
30-second timeout, 24,000 total tokens and 2,000 output tokens. An over-limit response
can be billed once; known usage remains accounted even when the check fails. Result JSON
must fit 160,000 bytes, reserving queue space for concrete usage receipts. The worker also
checks its complete serialized result envelope against 240,000 bytes and returns a small,
usage-preserving failure rather than an oversized success.

Rails accepts only exact queued listing/criterion coverage, finite numeric probabilities
from zero to one, the matching profile revision and unchanged live source digests. Unknown
keys, booleans, numeric strings, missing scores and old categorical result shapes are rejected.
A late old-worker result fails clearly and can be explicitly retried with the current worker. Finished tasks keep their outcome under duplicate delivery; late usage remains
independently deduplicated. The UI follows subscriptions, makes checks explicit, and
invalidates displayed conclusions when the loaded search snapshot or confirmed
revision changes. Normal already-loaded page navigation and hiding already-saved roles
preserve the snapshot. Draft-only preference edits do not invalidate a confirmed check.
No per-row query/subscription hooks are mounted: the one batch task supplies pure row views.

“Check these results” explicitly assesses all raw loaded candidates, before local hiding or
20-row paging. Preference fit ordering compares the mean must-have probability first,
then the mean nice-to-have probability, both descending; provider order breaks ties.
An absent priority group contributes zero uniformly, so an all-nice-to-have profile sorts
by its nice-to-have mean. No weighted blend, match threshold or status category is applied.
Every listing stays accessible. One Result order selector chooses search, career-library
or preference order and reuses completed results without model requests. Each row shows
explicitly labeled priority-group averages first, then remembered, initially collapsed
individual preference percentages. An omitted-source notice stays visible.
New search submissions, accepted refreshed pages, newly loaded provider pages and confirmed
profile revisions require an explicit new check; stale starts, completion, failures and busy
state cannot affect the newer scope or a replacement signed-in session.

Run `python -m evals.run_job_preference_evals` from the AI service for eight synthetic
native-JEV cases with evaluator-only broad expected probability bands. It prints numeric
probabilities and actual usage; no subjective judge, screening calls or report files are
used. Cases cover clear compatibility/contradiction, omissions, incompatible salary units,
remote restrictions, contradictory text, partial compound conditions and injected text.
Offline evaluator tests reject missing/nonpassing/NaN scores and execution failures.
`--batch-smoke` instead performs exactly four requests: a three-listing/three-preference
batch and a ten-preference boundary posting. It checks native numeric validity, independence,
broad directional bands and ordering, and reports cost/latency. Its uncertainty bands are
quality expectations, not probability calibration. A missing-source score outside a band
fails the runner and must be reported rather than relabeled to pass. A tiny smoke does not
establish general quality or 100-listing load performance.

## Optional hybrid reranking

The explicit “Rerank using my career library” action requests an asynchronous rerank
of currently loaded candidates. It does not change the search provider's keyword, remote, or selected
experience-level filters and does not infer a user's seniority. The Result order selector restores
search order or reuses a completed career ranking without starting new work. New searches and loaded pages have their own candidate snapshot; an old
ranking cannot reorder a newer set, and no new ranking starts automatically. Ranking is
limited to 100 loaded candidates.

`rerankJobBoardListings(input: {keyword:, listingIds:})` reads only those shared catalogue
IDs and queues `rerank_job_listings` with only the IDs and keyword.
The user cannot submit arbitrary descriptions. Python reads current catalogue text at execution;
locally formatted excerpts use a 140,000-byte combined text
budget, at most 6,000 UTF-8 bytes per listing; complete input must fit 200,000 UTF-8 bytes.
Normal AI admission and cost accounting apply. Identical recent queued work is reused.
A missing current-model career-library index returns a clear error instead of queueing.

The worker loads `{keyword, listing_ids: [...]}` from the owned queued task, reads the
selected shared catalogue payloads, and embeds locally formatted listing text in a batch,
and compares it with the task owner's existing career-library embeddings. Equal-weight
reciprocal rank fusion (k=60) combines mean top-three cosine similarity order with BM25
on the submitted keyword. Private library reads remain user/model-scoped. The AI role
can read only catalogue `id` and `payload` columns, never search pages. Retained legacy
tasks select their original IDs but ignore copied text; missing listings fail before embedding. There is no generative LLM call or
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
description headings. A paragraph that starts with a short label, such as "Duties: ...",
is its own small section; it never claims list items that follow it. When that label names
duties, responsibilities, skills, or requirements, its sentences (or semicolon items, for a long one-sentence list) become
bullets in both the extracted lists and the displayed text. Other long labelled
paragraphs move under their own label line. There is no LLM classification or automatic AI task on
import. The saved Job can then use the existing gap-analysis and tailoring flows.
Provider licence confirmation remains a commercial-rollout dependency.

## Verification

Colocated page tests exercise the GraphQL boundary, pagination, stale/error retry,
races, import warnings, private-list cache invalidation, and real route guards.
Rails service and GraphQL specs exercise provider HTTP fakes with real catalogue
and owner-scoped persistence. See [testing](../testing.md) for Docker commands.
Visual and responsive review remains a human QA step.
