# Interview answer transcription

The input selector controls how a candidate's recorded answer becomes text. It is
independent of browser/provider playback of the interviewer's saved reply. Browser
recognition is the default; the browser remembers the signed-in owner's choice.
Choose another mode between answers. The selected mode and any recorded-audio fallback
are shown beside recording controls.

Voice modes keep a complete WebM or MP4 recording for preview and fallback. Browser and
streaming dictation finalize into the same editable answer box used for typing. Interim
words are provisional: editing and another capture wait until recording and recognition
finish. Completed dictation appends to existing authored text once; later callbacks,
manual corrections and new interview revisions cannot overwrite the reviewed answer.
Discarding audio keeps reviewed text. Explicit Submit sends exactly that edited text
through the typed-answer contract, without uploading or retranscribing the recording. Supplied text remains
untrusted candidate input and goes through the same newest-answer screening and durable
turn acceptance as a transcribed recording. Failed recognition does not create a second
turn. Microphone denial cannot fall back without captured audio.

## Browser recognition

The browser's SpeechRecognition or webkitSpeechRecognition produces interim and final
results while the candidate speaks. Indexed results replace earlier versions rather
than appending duplicate interim/final words. Stop waits a bounded time for finalization.
Unsupported recognition, permission/service errors, unusable final text, and interruptions
select complete-recording transcription, with an explanation visible in the app.

Browser recognition availability and behavior depend on the device/browser. A browser
may send audio to its own recognition service; this is not a promise of on-device speech
processing. Feature detection and offline tests do not establish device support.

## Streaming transcription

The browser requests an owned capture capability through authenticated GraphQL and sends
it in the first WebSocket frame through the same-origin development proxy. Rails checks
the current interview, question, revision, expiry, resource limits and allowance. Only
the AI runtime connects to OpenAI; permanent provider credentials never reach the browser.

The browser converts microphone samples to mono PCM16 little-endian at 24 kHz, while
MediaRecorder independently retains the complete answer. Audio frames are bounded and
startup samples are buffered; an excessive backlog selects fallback rather than dropping
speech. The runtime uses explicit commit for the answer boundary and persists the complete
provider transcript in Rails before returning final text. Disconnect, cancellation and
finalization timeouts close this attempt; they do not automatically reopen a paid stream.

The fixed provider model is `gpt-live-transcribe`. The [official live transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
specifies a transcription session, manual commit, and PCM input. Live transcription has
its own conservative accounting reservation and reported-usage reconciliation. Missing
provider receipts remain unknown, including cancelled attempts. Browser elapsed time and
PCM length are not substitutes for provider billing receipts.

## Complete recording

The existing path uploads and seals the complete recording, then the AI runtime downloads,
validates and transcribes it with `gpt-transcribe` after submission. This mode also handles
fallback. Local development retains all usage records without adding new spending gates.

## Human device checks

Use the retained local QA stack at `http://127.0.0.2:15176/interviews/demo`. On each mode,
record, stop, edit the recognized words, submit, and reload after acceptance. Verify the preference survives
reload and accepted dialogue advances once. Disconnect the streaming network or deny
recognition permission while permitting microphone capture, and verify the visible fallback
still submits the same recording. Also check cancel/re-record and rapid repeated Submit.

Desktop Chrome, Edge, Safari and Firefox, plus iOS Safari and Android Chrome, require
manual device testing over HTTPS with microphone permission. Check mobile interruption,
network loss and unsupported recognition. Backgrounding or locking the device may interrupt
capture. Do not infer measured latency gains from the implementation alone: measure
speech-end to transcript-ready separately from submit to accepted interviewer reply.
