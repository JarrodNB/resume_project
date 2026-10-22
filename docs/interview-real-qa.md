# Real spoken interview browser QA

**Current local testing policy, 22 October:** real interviews stay running at the user's
explicit request. Development automatically allows local paid testing.
In development this removes the local unknown-cost/$5 verification stop and interview
monthly/hourly gates. Every provider attempt, estimate and actual cost is still recorded;
unknown costs stay unknown and never become fabricated zeroes. Resource concurrency and
execution caps remain active. This behavior has no effect outside development or on general AI work.

Local browser QA permits at most twenty provider calls per execution, including
transcription, re-screening saved dialogue, and interviewer requests. The smaller
eight-call probe limit can be consumed by history screening before the interviewer
runs. The real runtime exports privacy-filtered traces using `LOGFIRE_TOKEN` from
the original AI environment file, labeled `development`; fake and isolated paid
probes continue to disable remote export.

Open [Spoken interview](http://127.0.0.2:15176/interviews). The launcher starts a real
session prepared from owned career details, with a fictional role and nine typed questions.
Optionally enter a short career focus, then review the role and explicitly choose **Begin interview**; each question permits up to three
saved responses, and the interviewer may advance earlier.
Record, choose **Done answering**, listen to the local preview, then **Submit recording**.
The submitted recording influences the transcript and follow-up. The voice is AI-generated.
Preparation freezes the library at creation. Later library edits do not change this session.
Coaching remains outside this flow. Later questions receive bounded earlier accepted dialogue.
One full prepared session records one interview hourly admission. Normal admission defaults
remain 30 starts/hour and $3/month; this local QA mode does not enforce those spend/start gates.
Spoken interviews still have three concurrent-operation slots.
They do not consume general AI limits, and general AI usage does not consume interview limits.
Every preparation/turn/speech bill remains in the interview usage records.
Only one unfinished prepared session is allowed per account: resume or abandon it before
preparing another. Each question permits six submitted recordings, including failed inputs,
with at most three accepted responses. A processing retry reuses the original recording slot.

The public launcher rejects scripted sessions and has no mode selector. Older scripted
sessions are retired without changing their stored mode or deleting their records.
The old `cg-interview-qa` fake stack is stopped; its data volumes remain intact. The normal
root Compose fake-runtime profile was removed. Deterministic providers and their isolated
recovery harness remain for offline tests only.

## Resume uploads and other queued features

This browser URL uses the same Rails app for career-library uploads and spoken interviews.
The real QA overlay now starts local ElasticMQ (`sqs`), the Python `ai` worker and the Rails
`api-results-worker` alongside the interview runtime. The API publishes to `http://sqs:9324`;
it must not send local development credentials to AWS SQS. The launcher provisions the
standard local read-only `ai_reader` role and applies the repository table grants. Resume
processing uses the original AI environment file and the general AI allowance. The existing
interview runtime is not stopped by starting this stack.

If a previous upload says “Could not queue the AI task”, retry the upload after these services
are running. Previously failed tasks stay failed; no user resume is silently resubmitted.

## One retained database and truthful accounting

Browser QA now uses **cg-interview-12-paid**, the original paid verification database, not
the former fake QA database. Accounts from the fake database are not copied. Create a new
disposable local account at the same browser URL; if verification is required, use
[local account mail](http://127.0.0.2:13006/letter_opener).

Every real STT, screening, interviewer and TTS call keeps its original accounting identity
and reports actual usage when available. A speech marker of US$0.25 is a conservative local
estimate for a request whose final cost is not yet known: it is **not a charge, payment
reservation, hold or provider billing ceiling**. The user explicitly rejected blocking
local interviews on these estimates. The QA overlay therefore records estimates without
enforcing the verification stop or requiring lists of individually reviewed unknown IDs.
Do not erase markers, invent zero charges, reset volumes or start another paid database.
Non-development admission remains unchanged.
See [accounting](architecture/interview-provider-accounting.md).

## Start, inspect or stop

Run from the retained checkout. Credentials stay in the original ignored environment file;
the commands pass its path, never its contents. The launcher uses existing local images
`cg-interview-qa-api`, `cg-interview-qa-web` and `cg-interview-qa-interview-runtime`.
Rebuild them from this checkout if dependencies change.

```bash
export INTERVIEW_VERIFICATION_AI_ENV=/home/jarrod/Desktop/resume_project/services/ai/.env
bash /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/script/interview_real_qa.sh start
```

The original fake QA stack must be stopped first because it uses the same loopback ports.
Its volumes are preserved by this command:

```bash
docker compose -p cg-interview-qa -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml --profile qa stop
```

The real launcher keeps an existing runtime running, refuses a missing retained ledger,
checks storage preflights, then starts ordinary bounded recovery. In local unmetered mode
unknown costs and the verification target are informational; they do not block startup.
Starting resumes saved pending real operations, including opening speech;
it can spend money immediately. New sessions require safe runtime readiness and real admission.

With the same environment settings, inspect or stop without deleting data:

```bash
bash /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/script/interview_real_qa.sh status
bash /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/script/interview_real_qa.sh stop
```

The runtime may remain up for the authorized browser QA. Only new submissions, saved pending
operations and bounded recovery dispatch paid work; idle health checks do not call providers.
If an operation shows a budget error, inspect its usage evidence before retrying. Ordinary
provider/storage recovery stays bounded by leases, deadlines and attempt caps. Speech retry
uses the saved message; it never repeats an accepted answer's transcription or reasoning.

## Human browser checks

1. Sign in, choose **Prepare interview**, review the fictional role, then **Begin interview** and play the opening.
2. Record a short answer. Confirm **Done answering** offers preview/discard/re-record and
   uploads nothing until **Submit recording**.
3. Confirm the transcript follows your answer and the follow-up is relevant. Reload during
   processing; the same saved operation should return without submitting again.
4. Answer follow-ups. Each question advances by its third saved response, or earlier if the
   interviewer chooses. The ninth question leads to exactly one final closing.
5. Test permission denial, playback failure, reconnect and unsaved navigation warnings.
   Keep consented recordings short. Raw recordings and speech retain the existing expiry rules.
6. Open **Recent interviews** on the spoken start route. Resume preparing, ready and active
   sessions; review completed sessions. Only your latest 20 unexpired real sessions appear.
7. On an unfinished session, choose **Abandon interview**. Cancel first and confirm the
   recording remains. Confirm abandonment and check that recording/continuation and fresh
   playback grants stop. The UI returns to the interview overview with an ended confirmation,
   without a second unsaved-answer warning. Old abandoned-session links also return there.
   Ended or expired entries never offer Resume. Local audio and
   pending submission recovery clear only after saved confirmation. The normal unsaved
   recording warning still applies when navigating away without submitting.
   Private objects are deleted by durable cleanup; already-issued short URLs may work until
   expiry or deletion. Billing and unknown usage remain recorded. Completed sessions have no
   abandon action.

Local S3Mock verifies application ownership and byte handling but does not enforce production
signed-URL expiry. This local development stack is not a production deployment.

Local development starts without paid-use approval flags. Interview spending and unknown-cost estimates remain recorded without blocking local testing.

## Setup room manual checks

Queued question clarification needs `INTERVIEW_RAILS_ORIGIN` and the same
`INTERVIEW_SERVICE_SECRET` as Rails on the ordinary AI queue worker, not only the
interview runtime. The real-QA overlay supplies both. Clarification feedback opens
in a floating panel with a fixed trigger label, so waiting/errors/explanations do
not reflow the question controls. Check Escape/outside dismissal and narrow-screen
panel placement. Failed clarification attempts still need an explicit Retry.

Before preparing, verify Mixed, Realistic, Daniel and Standard (8 questions) are
selected, with no focus areas. Try all four types, three difficulties and
interviewers, Short/Standard/Full loop, and multiple focus areas using keyboard
and pointer. Length estimates belong only to length choices. Check the layout at
narrow mobile and desktop widths in both themes; labels must wrap without clipping.

Change automatic microphone and thinking time (Off/3/5/10 seconds). No capture or
permission request should occur during setup or fictional-role review. Reload and
confirm the same account remembers these preferences; another account should keep
its own settings. An unsupported microphone browser must still offer typed answers.

Prepare with your chosen options. The submit action should lock
while saving. Check an empty library error, unfinished-interview recovery and a
failed preparation retry. On the saved role review, verify the role and selected
configuration, including focus areas, before choosing **Enter interview room**.
The role-review page should have no Recent interviews link. Before entry, use
Cancel preparation to release an unfinished setup; after entry, the action is
Abandon interview. Each main question permits up to two related follow-ups under
the current three-response cap. The active interviewer message should appear in
History immediately, once, alongside earlier saved dialogue.

After entry, check the interviewer identity and settings, playback-before-capture,
thinking countdown, tapping the microphone early, and editable live dictation.
Priya probes after submission; live interruptions are outside this setup.
