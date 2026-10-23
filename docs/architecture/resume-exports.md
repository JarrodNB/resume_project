# Resume export pagination

The browser builds the downloadable DOCX. It sends that exact Blob to authenticated
`startResumeDocxPageCheck(file, contentDigest, resumeId?, retryFailed?)`, using its SHA-256
digest. A saved resume ID, when present, is owner-scoped; draft exports do not need one.
The owner polls `resumeDocxPageCheck(id)` only while the matching export is relevant.
This is a first-party document check, separate from AI tasks, costs and PDF export.
LibreOffice pagination can differ from Microsoft Word. Pending, failed and overflowing
checks do not block downloads. The converted PDF is never a replacement export.

## Private bytes and bounded work

Rails owns a `ResumeDocxPageCheck` containing a digest, status, optional page count,
expiry and a private S3 cleanup key. No download URL or converter diagnostic is exposed.
`DocumentPageChecks::PrivateStorage` uses the existing `S3_UPLOADS_BUCKET` and
`S3_ENDPOINT_URL` settings, under `private/document-page-checks/`; it bypasses public
Active Storage routes. Production bucket access must remain private.

Uploads are limited to 5 MB, 512 ZIP entries and 20 MB expanded contents. Package
validation rejects encrypted entries, malformed XML, macros, embedded objects,
dynamic Word fields and external resources. HTTP(S)/mailto hyperlinks remain inert
and supported. Conversion validates the stored bytes against the original digest again.

Start admission allows two in-flight checks per owner, 20 new digests per hour,
two explicit failed retries per digest and 100 in-flight checks globally. Identical
active or completed digests reuse their record. Failed results remain visible until
an explicit retry; failures do not loop automatically. The database serializes claims
and permits two conversions at once, regardless of the number of Rails workers.
An execution token fences terminal updates; duplicate delivery cannot replace a result.
Queued checks time out after ten minutes; running leases expire after two minutes.

Both existing Rails images include LibreOffice Writer, Liberation/Carlito fonts,
pdfinfo and the compiled seccomp launcher. Each conversion gets a private temporary
profile/directory, cleared application environment, bounded CPU/memory/output/files,
and a 30-second process deadline. The child cannot create internet sockets, including
AWS metadata access; it retains local Unix sockets needed by LibreOffice. Timeout
kills the complete process group. Temporary files disappear after each attempt.

## Recovery and retention

Private bytes are deleted promptly after conversion or a failed upload/enqueue.
Each upload reserves a 30-second deadline before releasing its database lock. A writer
refuses to start a PUT after that deadline and the remaining reservation time bounds
the PUT with a timeout; scheduling delays never grant it a fresh lease. Storage I/O
runs outside row locks. Successful PUT completion clears the upload lease before
acceptance or rejection is recorded, so normal deletion can finish immediately.

An interrupted or failed PUT can still commit remotely after a DELETE has returned.
Its key therefore remains a durable tombstone for five minutes beyond the upload
deadline, including after account deletion. Cleanup repeats DELETE during that interval
and only forgets the key after a successful DELETE once the interval ends. A pending
key blocks retries; later attempts receive distinct keys. This bound assumes storage
finishes or abandons an interrupted PUT within that five-minute grace (the S3 client
has a three-second connection timeout, five-second read timeout and no retries).
The Ruby timeout also prevents a paused, expired reservation from starting a new PUT
when execution resumes. A process crash leaves the same durable lease for the sweeper.
A failed deletion retains its database key for retry. Account/resume deletion nulls
the association rather than deleting the cleanup obligation. The cleanup service
rotates attempts across batches of 100 so a storage outage cannot starve later keys.
It also re-enqueues durable queued checks missed during process interruption and
fences expired executions. Metadata expires after 23 hours and is removed by the next
cleanup pass; expired records cannot be queried. A storage outage retains cleanup
obligations until S3 is reachable, rather than claiming that inaccessible bytes were deleted.

Production Puma runs Solid Queue in the same Rails image by default, including the
every-minute `DocumentPageChecks::CleanupChecksJob` recurring task. Disable
`SOLID_QUEUE_IN_PUMA` only when a separate `bin/jobs` supervisor using that image is
actually deployed; prepare the configured queue database with `db:prepare` first.
Development uses the async adapter, so its normal single-process Puma server owns
an every-minute executor-wrapped recovery loop instead of relying on `recurring.yml`.
No separate conversion container is required.

## Verification

Run the ordinary DOCX specs in the Rails runtime image with an isolated test database:

```bash
docker compose run --rm api bundle exec rspec spec/services/document_page_checks spec/graphql/mutations/resume_docx_page_checks_spec.rb spec/requests/resume_docx_page_checks_spec.rb
```

`runtime_spec.rb` performs real LibreOffice conversion, rejects risky packages, verifies
network restriction, and exercises timeout/process-group cleanup. The opt-in
`real_export_integration_spec.rb` additionally uses two synthetic exports produced by
the app (`short.docx`: one page; `overflow.docx`: four pages), real private S3 storage,
the durable job and prompt object deletion. The synthetic fixtures and exporter-based generator are committed in
`services/api/spec/fixtures/resume_exports/`; see its README to refresh them. Set
`DOCX_REAL_STORAGE_TEST=true` and point S3 settings at isolated S3Mock. Optional
`DOCX_EXPORT_FIXTURES` overrides the committed fixture directory.
Independent pypdf parsing of the synthetic converted PDFs verifies their 1/4 counts.
