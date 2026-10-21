# Improving Careergrind's interview experience using InterviewVoice

Findings recorded 21 October 2026 (Asia/Manila). This document compares the
actual interview experience and proposes focused improvements to Careergrind.
It is a starting point for design and measurement, not an approved implementation
plan or a reason to expand product scope.

## Goal and scope

Use the neighboring `interview_voice` project as a working reference to make
Careergrind interviews feel more natural, focused and responsive. Scoring,
coaching, reports, answer rewrites, story banks and progress analytics are
explicitly outside the current goal. Their presence in InterviewVoice should
not count toward this comparison or imply that Careergrind needs them.

The initial comparison overemphasized those extra features. The narrower finding
after browser inspection is that InterviewVoice still leads in presentation and
conversational continuity, while Careergrind already demonstrates relevant
follow-ups and has durable execution worth preserving.

## Evidence and limits

- Read both projects' implementation and documentation. Careergrind was inspected
  at `d2b7503` on `work/basic-interview-fastapi`, in
  `/home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi`.
  Its epic is [PR #63](https://github.com/JarrodNB/resume_project/pull/63).
- InterviewVoice was inspected at `0e88795`, in
  `/home/jarrod/Desktop/interview_voice`. That repository was read without edits.
- Used InterviewVoice at `http://localhost:8080`: started a five-question mixed
  software interview with Daniel, manual microphone control and the configured
  AI backend. Submitted three explicitly fictional typed responses covering one
  main question and two follow-ups, then reached question two.
- Used Careergrind at `http://127.0.0.2:15176`: inspected setup, recent sessions,
  an existing active nine-question session, its saved answer and follow-up, and
  the saved-audio controls. Did not add answers to the user's session.
- Reloaded both apps. Both restored the current question and saved conversation
  in these checks. This does not establish equivalent recovery guarantees.
- The user reports that **Careergrind is a good bit slower**. Treat this as a
  real user-experience problem. No comparable latency timings were collected,
  so neither its size nor its dominant cause has been measured here.
- No comparable microphone test, audible voice-quality assessment, full live
  session or controlled provider benchmark was performed. Browser text and
  screenshots cannot establish those qualities.

## Findings

| Area | InterviewVoice | Careergrind | Implication |
| --- | --- | --- | --- |
| Interview room | Named interviewer, prominent current question, clear turn state and live transcript | Saved-conversation presentation with recording and audio controls | Give Careergrind a dedicated interview room with one obvious next action |
| Conversational continuity | Acknowledges details before probing or moving on | Observed saved follow-up directly probes the answer, without a separate acknowledgement | Preserve relevant probing; test short natural bridges where they help |
| Answer interaction | Browser transcription appears in an editable answer field; direct submit | Record, stop, preview, explicit submit, then processing | Reduce interaction overhead while preserving deliberate submission and useful review |
| Interviewer speech | Browser speech synthesis accompanies the conversation flow | Saved speech is loaded through explicit playback controls | Make hearing the next turn feel continuous, with a clear replay control |
| Attention | Current question and turn-taking dominate the room | Retention/provider explanations, response counts and duplicate reply text compete with the interview | Keep necessary information accessible while simplifying the active room |
| Latency | User experiences it as faster | User experiences it as substantially slower | Measure and improve both actual wait and how the wait is presented |

### Follow-up behavior observed

In InterviewVoice, the fictional initial answer described a booking tool using
Rails and React, explicitly leaving testing and support unexplained. The
interviewer acknowledged those details and asked how the tool was tested and
supported after launch.

The second answer described tests, duplicate bookings and a database constraint,
but no measured outcome. The next probe asked what verification or production
evidence showed that duplicates had stopped. After a third answer supplied that
evidence, the interviewer acknowledged it and moved to the next main question.
This was a coherent chain tied to what was actually said.

Careergrind's existing answer described shipping business-plan generation in
Rails under a deadline and later rebuilding it in FastAPI. Its follow-up asked
what was prioritized for the first version and what changed in the rebuild.
That is also relevant, specific interviewing. The evidence does not support a
claim that Careergrind's model is fundamentally worse at asking follow-ups.

InterviewVoice's acknowledgements sometimes repeat much of the answer. Copy
the useful continuity, not an obligation to summarize every response. Long
acknowledgements can slow the interview and sound formulaic.

## Latency: investigate the whole turn

The architectures do different work. InterviewVoice uses browser speech
recognition and browser speech synthesis, sending text to a direct follow-up
endpoint. Careergrind uploads recorded audio, transcribes it on the backend,
screens context, generates a response, accepts durable state, then runs separate
speech work and stores its audio. Browser speech APIs may themselves use remote
services; they should not be described as guaranteed offline processing.

These differences plausibly contribute to the gap, but code inspection alone
does not identify the bottleneck. Careergrind's runtime also discovers work on
a two-second interval by default; separate turn and speech operations may incur
discovery waits. Measure that contribution before changing execution design.

Capture timestamps for:

1. Done answering → review ready, and Submit → upload complete.
2. Operation created → claimed.
3. Transcription, screening and interviewer execution, separately.
4. Response accepted → visible in the browser.
5. Speech operation created → claimed → synthesis complete → media ready.
6. Media ready → playback available → first audible speech after playback starts.

Separate deliberate user review/listening time from system latency. Compare
similar-length answers under similar conditions, include warm and cold runs,
and record failures/retries. Report median and tail latency once enough samples
exist; do not infer timing from browser-tool call durations.

Potential improvements should follow the measured bottleneck: faster durable
work notification, reduced redundant context/screening within established
coverage rules, shorter model output, or earlier audio delivery. None is an
instruction to remove screening, bypass accounting or introduce streaming now.
Live transcription or browser TTS would change privacy, compatibility and
recovery behavior and require a separate design decision.

## Recommended improvements, in order

### 1. Make the current interview the center of the screen

Use InterviewVoice's room as a reference: current question, progress, interviewer
identity and a clear state such as “Your turn”, “Review your recording”,
“Processing your answer” or “Interviewer speaking”. A simple interviewer label
is enough; multiple personas and avatars are not required.

Avoid rendering the latest reply twice. Keep earlier dialogue in a secondary
transcript view. Move detailed retention explanations out of the dominant room
area while keeping them easy to find, and retain clear provider disclosure at
the appropriate entry point. “Responses saved” is accurate but should not be the
main framing for an interview.

### 2. Smooth the speaking and answering transitions

Present a single clear next action for each state. Preserve explicit submission,
recording preview, discard and re-record; evaluate how to make review lightweight
instead of removing it without a user decision. Silence must not submit.

Explore playing accepted interviewer speech automatically when browser policy
and user choice allow it, with obvious replay, pause and mute controls. Handle
blocked autoplay visibly. Keep speech retries independent of accepted reasoning.
An interviewer acknowledgement, when used, should be brief and lead directly to
the probe or next question.

### 3. Measure and reduce the slowest parts of the turn

Establish the latency breakdown above before choosing a backend change. Show
honest, understandable progress while the answer is processing, without exposing
internal operation jargon or making unsupported time promises. Better feedback
helps perceived responsiveness, but does not resolve the reported actual delay.

### 4. Compare conversational quality with matched examples

Use the same fictional scenarios to compare incomplete answers, complete answers,
requests to repeat, brief detours and callbacks to earlier answers. Check whether
each probe uses actual details, avoids repeating covered ground, respects the
response cap and moves on naturally. Start with a small manual comparison;
this document does not authorize paid judges or a new evaluation program.

## What to preserve

Careergrind's Rails-owned state, stable submission identities, duplicate-safe
acceptance, fenced execution, independent speech recovery, private media,
screening/contact masking and provider accounting remain valuable. Improve the
experience on top of these guarantees. InterviewVoice's browser-owned state and
silent fallback behavior should not be copied wholesale into a hosted product.

Keep Careergrind's career-library grounding, explicit Begin after role review,
nine-question progression and current response limits. Do not import scoring,
coaching, difficulty/persona selectors or additional interview types merely
because the reference app has them.

## How to judge success

- The user can immediately tell whose turn it is and what to do next.
- The current question and reply dominate; setup and operational details recede.
- Follow-ups react to the answer and transitions feel connected without excessive
  paraphrasing.
- Recording review and submission remain clear, with fewer distracting controls.
- Matched measurements show reduced system delay, and the user confirms the
  interview feels faster.
- Reload, ambiguous submission and speech-failure recovery still work.

The next useful work is a focused room/turn-flow proposal plus a measured latency
baseline. The reference provides interaction ideas; it does not require replacing
Careergrind's architecture or expanding its interview scope.
