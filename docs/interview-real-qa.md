# Real spoken interview browser QA

Open [Spoken interview](http://127.0.0.2:15176/interviews/demo). The launcher starts a real
session with fictional context, one prepared question and at most two accepted answers.
Record, choose **Done answering**, listen to the local preview, then **Submit recording**.
The submitted recording influences the transcript and follow-up. The voice is AI-generated.
No coaching, career-library targeting or full interview preparation is included yet.

The public launcher rejects scripted sessions and has no mode selector. Older scripted
sessions are retired without changing their stored mode or deleting their records.
The old `cg-interview-qa` fake stack is stopped; its data volumes remain intact. The normal
root Compose fake-runtime profile was removed. Deterministic providers and their isolated
recovery harness remain for offline tests only.

## One retained database and spending allowance

Browser QA now uses **cg-interview-12-paid**, the original paid verification database, not
the former fake QA database. Accounts from the fake database are not copied. Create a new
disposable local account at the same browser URL; if verification is required, use
[local account mail](http://127.0.0.2:13006/letter_opener).

Every real STT, screening, interviewer and TTS call passes the original cumulative US$5
verification allowance. The historical US$0.25 unknown reservation remains unresolved and
counts at its full estimate. The user explicitly authorized continuing; only that original
observation (`57cb5021-6d37-465e-a56a-5eeee3bbb769`) was reviewed for admission. Any **new**
unknown receipt blocks further paid calls. Do not append new IDs automatically, invent zero
charges, reset volumes or start another paid database. This is an estimated local allowance,
not a provider-side hard spending ceiling. See [accounting](architecture/interview-provider-accounting.md).

## Start, inspect or stop

Run from the retained checkout. Credentials stay in the original ignored environment file;
the commands pass its path, never its contents. The launcher uses existing local images
`cg-interview-qa-api`, `cg-interview-qa-web` and `cg-interview-qa-interview-runtime`.
Rebuild them from this checkout if dependencies change.

```bash
export INTERVIEW_VERIFICATION_AI_ENV=/home/jarrod/Desktop/resume_project/services/ai/.env
export INTERVIEW_REVIEWED_UNKNOWN_OBSERVATIONS=57cb5021-6d37-465e-a56a-5eeee3bbb769
export INTERVIEW_REAL_QA_APPROVED=yes
bash /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/script/interview_real_qa.sh start
```

The original fake QA stack must be stopped first because it uses the same loopback ports.
Its volumes are preserved by this command:

```bash
docker compose -p cg-interview-qa -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml --profile qa stop
```

The real launcher stops its runtime before preflight, refuses a missing retained ledger or
unreviewed unknown usage, checks the allowance and storage preflights, then starts ordinary
bounded recovery. Starting resumes saved pending real operations, including opening speech;
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

1. Sign in, choose **Start interview**, and play the opening.
2. Record a short answer. Confirm **Done answering** offers preview/discard/re-record and
   uploads nothing until **Submit recording**.
3. Confirm the transcript follows your answer and the follow-up is relevant. Reload during
   processing; the same saved operation should return without submitting again.
4. Answer the follow-up. The interview must close by the second accepted answer and allow
   saved audio playback without accepting a third answer.
5. Test permission denial, playback failure, reconnect and unsaved navigation warnings.
   Keep consented recordings short. Raw recordings and speech retain the existing expiry rules.

Local S3Mock verifies application ownership and byte handling but does not enforce production
signed-URL expiry. This local development stack is not a production deployment.
