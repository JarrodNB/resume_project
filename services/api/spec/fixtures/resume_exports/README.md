# Synthetic browser export fixtures

These two small DOCX files were created by the actual web `generateResumeDocx`
exporter using `generate.mjs`. Every name, address, URL and achievement is invented.
The fixtures include the normal heading/bullet styles and an inert HTTPS hyperlink.
`short.docx` has three achievements and renders to one page with the Rails image's
LibreOffice/fonts; `overflow.docx` has 120 and renders to four pages. Independent
pypdf parsing confirmed those counts. The integration spec uploads these exact bytes,
then uses the real storage, job and converter before confirming private bytes are gone.

From the checkout root, refresh after changes to export formatting:

```bash
docker compose run --rm --no-deps -v "$PWD/services/api/spec/fixtures/resume_exports:/fixtures" web node --experimental-strip-types /fixtures/generate.mjs /fixtures
```

Re-run the real storage integration test and independently verify rendered PDF counts
after refresh. A fixture byte/digest change caused by DOCX ZIP timestamps is expected.
The fixture generator runs in Node without browser automation or provider calls.
