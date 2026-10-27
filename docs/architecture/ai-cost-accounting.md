# Per-user AI cost accounting

`me { aiUsage }` reports the current UTC month's known costs for general AI,
all spoken-interview stages, and background career-library / saved-Q&A embeddings.
`monthlyBudgetUsd` sums the independent general and spoken allowances. Admission
checks explicitly select their allowance; aggregation does not combine task-rate
or concurrency limits. Background embeddings contribute spend but create no task
start or concurrency slot.

`incompleteAttempts` counts unresolved task executions and embedding requests.
`accountingComplete` is false while that count is positive. Known subtotals remain
available; neither missing usage nor missing prices are treated as free calls.
These fields cover recorded requests, not historical embeddings made before their
ledger existed. Paid quality evaluations and infrastructure costs are separate.

## Provider receipts and prices

Queued Luna requests explicitly use standard service and a 30-minute cache
lifetime. Its calculator subtracts cache reads and writes from ordinary input,
then prices each category once. The pinned SDK retains total cache writes but
loses the lifetime split, so requests cannot select 12-hour writes. Unsupported
long contexts and unexpected models remain incomplete. Spoken interviews keep
their explicit no-cache mode and reject unexpected writes.

Queued receipts retain cache-write tokens and provider response IDs. Earlier Luna
receipts without write counts are marked incomplete by migration; their known
totals are preserved. A verified receipt can correct those estimates.

The Python price table and Rails embedding price file are reviewed, versioned
rates. `script/check_ai_prices.py` compares them with a freshly fetched
genai-prices catalogue without paid calls. GitHub Actions runs it weekly, on
price-related PRs, and on demand. A failed download or mismatch fails the check;
it never rewrites prices or past receipts. Use the provider's official pricing
documentation to review drift before changing either file.

Each Rails embedding batch commits its own request marker on a separate database
connection before contacting OpenAI. It sends the marker UUID as
`X-Client-Request-Id`, disables SDK transport retries, and commits received usage
before vector validation or persistence. Failed jobs retry with new request IDs;
earlier bills and unknown markers survive the library transaction rolling back.
Keep at least one database connection available beyond concurrent sync workers.

## Reconcile verified receipts

Provider account-level totals cannot reliably identify an application's individual
users. Missing receipts require verified request-level evidence, not dividing an
invoice across users or rerunning a model. No admin billing key is needed for the
import below, and no provider requests are made by these commands.

List unresolved records:

```bash
docker compose run --rm api bin/rails ai_usage:unresolved
```

Prepare a JSON array from verified evidence. `record_type` is `task` for an
`ai_usage_attempts.attempt_id`, or `embedding` for an `ai_embedding_requests.id`.
Include the exact owner. `usage` replaces the entire accounting request's totals;
include all received charges for that attempt, not just a delta. References must
identify a unique provider receipt or invoice line.

```json
[
  {
    "user_id": "<account UUID>",
    "record_type": "task",
    "attempt_id": "<attempt UUID>",
    "receipt_reference": "provider-receipt-line-123",
    "usage": [{"input_tokens": 10000, "cache_write_tokens": 8000, "output_tokens": 1000, "cost_microdollars": 1700}]
  }
]
```

Review a dry-run, then apply the same file from an operator-controlled path:

```bash
docker compose run --rm -e RECEIPTS=/app/tmp/verified-receipts.json api bin/rails ai_usage:reconcile
docker compose run --rm -e RECEIPTS=/app/tmp/verified-receipts.json -e APPLY=true api bin/rails ai_usage:reconcile
```

The import locks owner then task/request, retains previous evidence in
`ai_usage_reconciliations`, applies only the difference to task totals, and clears
the request's incomplete marker. Identical reimports are no-ops; conflicting
receipts are rejected. Spoken verification reservations are reconciled too.
Task outcomes and the original task-creation-month attribution stay intact.
Original finalized reports cannot overwrite the verified receipt on redelivery.
The command stops at the first invalid row; rerunning the corrected file safely
skips already-applied receipts. Deploy both Rails migrations before new workers.
