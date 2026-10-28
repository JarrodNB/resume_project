# Interview answer transcription

The input selector controls how a candidate's recorded answer becomes text. It is
independent of browser/provider playback of the interviewer's saved reply. Browser
recognition is the default; the browser remembers the signed-in owner's choice.
Choose another mode between answers in Interview settings. Recorded-audio fallback
messages remain beside the answer controls.

Voice modes keep a complete WebM or MP4 recording for preview and fallback. Browser and
streaming dictation appear live in the same answer box used for typing. Interim words
update in place after any existing authored text, and the final transcript replaces
that provisional portion. The answer box stays editable during recording and finalization. Manual edits protect
the text already shown; new dictated words continue after it. Submission and another
capture wait until recording and recognition finish. Completed dictation appends to existing authored text once; later callbacks,
manual corrections and new interview revisions cannot overwrite the reviewed answer.
Discarding audio keeps reviewed text. Explicit Submit sends exactly that edited text
through the typed-answer contract. Browser and streaming results need no audio upload;
complete-recording review uploads once for transcription and never retranscribes on Submit. Supplied text remains
untrusted candidate input and goes through the same newest-answer screening and durable
turn acceptance as a transcribed recording. Failed recognition does not create a second
turn. Microphone denial cannot fall back without captured audio.

## Microphone capture

Answer capture requests mono audio with echo cancellation, noise suppression, and
automatic gain control as preferred constraints. Browsers negotiate these preferences
with the device; unsupported preferences do not prevent recording. MediaRecorder
targets 128 kbps to avoid relying on browser encoding defaults. The same captured
stream feeds streaming transcription and the complete recording. Browser speech
recognition manages its own microphone input, so these settings do not control it.
Real-device listening checks are still needed to assess noise, distortion, and volume.

## Microphone timing

The interview lives at `/practice/interviews` (the Mock interview tab); older `/interviews` links redirect there.
Interview settings contain transcription mode, automatic microphone capture, and a
thinking pause of 0, 3, 5, or 10 seconds. Turning automatic capture off also sets
the thinking pause to Off and disables its selector. Automatic capture starts off
until the user enables it; the browser remembers this choice for the signed-in account.
After interviewer playback stops, the countdown runs before opening the microphone.
The Record answer button starts sooner. Typing or manually recording cancels the
automatic start for that prompt. Playback, settings, a hidden tab, and pending work
pause the countdown. The microphone never submits an answer automatically.

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

After stopping, choose Transcribe recording to upload and seal the complete audio. A bounded
durable transcription operation runs asynchronously in the AI runtime using `gpt-transcribe`.
The result arrives through the interview subscription and fills the same editable answer box.
Review or replace it, then choose Submit answer. Transcription alone never invokes the
interviewer, advances the question, or consumes a response slot. Recognition fallback uses
this same flow. Transcription errors retain local audio and reviewed text; eligible failures
have an explicit bounded Retry transcription action. Repeated starts reuse the same sealed
recording and operation after a lost receipt. Discard, re-record, typing a replacement, and
changed interview revisions fence late text. Private capture text expires with its audio;
user edits stay only in memory. Local development retains provider usage records without
adding new spending gates. Historical audio-turn API callers remain compatible.

## Human device checks

Settings explains each mode and suggests streaming or recorded transcription when browser
recognition is unreliable. The answer box fills while live words arrive. Before any words
arrive, a Listening for words status explains how to recover; silence alone is not treated
as a failure. Known recognition/connection errors show Live transcription stopped and keep
the complete recording. Finish recording, then explicitly choose Transcribe recording to
fill the answer for review. Nothing is automatically submitted. Submit or discard the
current recording before changing modes, or type/correct the answer instead.

Use the retained local QA stack at `http://127.0.0.2:15176/practice/interviews`. On each mode,
record, stop, edit the recognized words, submit, and reload after acceptance. Verify the preference survives
reload and accepted dialogue advances once. Disconnect the streaming network or deny
recognition permission while permitting microphone capture, and verify the visible fallback
transcribes the same recording for editable review before final text submission. Also check cancel/re-record and rapid repeated Submit.

Desktop Chrome, Edge, Safari and Firefox, plus iOS Safari and Android Chrome, require
manual device testing over HTTPS with microphone permission. Check mobile interruption,
network loss and unsupported recognition. Backgrounding or locking the device may interrupt
capture. Do not infer measured latency gains from the implementation alone: measure
speech-end to transcript-ready separately from submit to accepted interviewer reply.
