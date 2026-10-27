/** Keep an unfinished interview actionable while the new job's setup stays mounted. */
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { AbandonInterviewButton } from './AbandonInterviewButton'
import type { useInterviewStartRecovery } from './useInterviewStartRecovery'

export function InterviewStartRecovery({ recovery, busy, failedStart }: {
  recovery: ReturnType<typeof useInterviewStartRecovery>; busy: boolean; failedStart: boolean
}) {
  const interview = recovery.interview
  if (!interview && !recovery.checking && !recovery.error && !failedStart) return null
  return <section className="grid gap-3 border-y py-4" aria-label="Interview start recovery">
    {recovery.checking && <p role="status" className="text-sm">Checking unfinished interviews…</p>}
    {interview && <>
      <h3 className="font-medium">You have an unfinished interview</h3>
      <div className="grid gap-1 text-sm">
        <p className="font-medium break-words">{interview.jobContext?.title ?? 'Fictional-role interview'}</p>
        {interview.jobContext && <p className="text-muted-foreground break-words">{interview.jobContext.company ?? 'Unknown company'}</p>}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">Resume it, or end it before preparing for this job. Your choices below will stay here.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link className="text-sm underline underline-offset-4" to={`/interviews/${interview.id}`}>Resume interview</Link>
        <AbandonInterviewButton beforeStart={interview.status !== 'active'} busy={busy || recovery.busy || recovery.checking}
          dirty={false} error={recovery.error} abandon={recovery.abandon} onAbandoned={() => {}} />
      </div>
    </>}
    {failedStart && !interview && <p className="max-w-prose text-sm text-muted-foreground">{recovery.canPrepare ? 'No unfinished interview was found. Your choices are kept; choose Prepare interview to try again.' : 'Check saved interviews before trying again. A saved preparation can be resumed without starting another.'}</p>}
    {recovery.error && <p role="alert" className="text-sm text-destructive">{recovery.error}</p>}
    <Button type="button" variant="outline" className="justify-self-start" disabled={busy || recovery.busy || recovery.checking}
      onClick={() => void recovery.refresh()}>Check saved interviews</Button>
  </section>
}
