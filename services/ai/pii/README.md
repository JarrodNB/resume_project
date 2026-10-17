# Local import contact protection

`prepare_document(text, names=(), emails=(), phones=())` returns masked text and an
opaque `MaskingSession`. Optional known profile values augment local detection.
The session masks discovered values in other strings with `mask`, and restores
strings, lists, tuples, dictionaries (including keys), and Pydantic models with
`restore`. `unmask` restores one string. Unknown generated privacy tokens fail with
`PiiRestorationError`; detector failures raise a content-free `PiiDetectionError`.
Incomplete generated token fragments also fail; literal token-looking source strings
round-trip safely. Repeated masking leaves generated tokens intact, including when a
contact value matches a token marker. Matching elsewhere is case-insensitive; exact
source variants have their own tokens so restoration preserves the document's case.

`TaskPrivacy` retains that session for the complete worker execution. Provider and
telemetry adapters delegate to it; import response hooks leave tokens in place until
the handler restores the complete structured output. Known profile values, even when
absent from the document, share the same namespace after preparation.

Keep the session only in task memory, including telemetry callbacks that finish after
the import scope exits. Its representation omits the replacement map and pickling is
disabled. Never inspect, log, or persist its private state. A session belongs to one
import attempt. Only the detector/model is cached across tasks.

Only PERSON, EMAIL_ADDRESS, and PHONE_NUMBER recognition is enabled. Presidio owns
recognition; the module owns overlap selection, exact case-preserving replacements,
typed tokens, and restoration. Literal privacy/legacy-contact token strings are escaped
before masking so they survive a round trip and cannot collide with profile tokens.
Email recognition keeps Presidio's structural pattern without online public-suffix
validation, protecting private/test domains too. No detector-time network is needed.

## Assets and limits

The lockfile pins Presidio Analyzer 2.2.362, spaCy 3.8.11, and the English
`en_core_web_sm` 3.8.0 wheel (including its SHA-256). These packages/model use the
MIT license. The model metadata declares spaCy >=3.8,<3.9 compatibility. The image
uses Python 3.13.11; both installation and real analysis were verified on it. Click
8.3.1 is explicit because spaCy's CLI imports it but the newest Typer dependency
does not install it. The image build loads the installed model as a smoke check.

This English model can miss names, especially unfamiliar or multilingual names, and
can mistake other resume text for names. Phone coverage depends on format and context.
On eight synthetic name headers, it masked every component of seven: John Smith,
Maria Garcia, David Chen, Wei Zhang, Aarav Patel, José García, and Fatima Al-Hassan.
It missed components of Nguyễn Văn An. This is a small coverage probe, not an accuracy
guarantee. Tests cover US, UK, Singapore, and India international-format phones and
preservation of Python/API facts, Microsoft, and dates. Detection does not cover
addresses, general URLs, or all possible PII.

An offline probe in `careergrind-pii-ai:latest` used `docker run --rm --network none`
with this checkout bind-mounted at `/app`. Cold preparation (imports, model loading,
and first analysis) took 1.886 seconds; subsequent short resumes took 0.005–0.017
seconds on the development host. The development image was approximately 884 MB.
The Docker build's isolated `spacy.load` smoke took 7.2 seconds under build load.
These timings vary with hardware and document size.

Sources: [Presidio package](https://pypi.org/project/presidio-analyzer/2.2.362/),
[spaCy package](https://pypi.org/project/spacy/3.8.11/),
[model metadata and license](https://github.com/explosion/spacy-models/blob/master/meta/en_core_web_sm-3.8.0.json).
