/** A quiet, initially closed explanation beside its exact prompt. The answer editor remains independent. */
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { useInterviewClarification } from './useInterviewClarification'

type Props = { interviewId: string; message: InterviewSnapshotFragment['messages'][number]; disabled: boolean }

export function InterviewClarification({ interviewId, message, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const clarification = useInterviewClarification(interviewId, message.id, message.clarification)
  return <div className="grid justify-items-start gap-2">
    <Button variant="outline" disabled={disabled} aria-expanded={open} aria-controls={panelId}
      aria-busy={clarification.pending} onClick={() => {
        setOpen((value) => !value)
        if (!open && !clarification.failed) void clarification.clarify()
      }}>{clarification.pending ? 'Clarifying question…' : open ? 'Hide clarification' : 'Clarify question'}</Button>
    {open && <div id={panelId} role="region" aria-label="Question clarification" className="grid max-w-prose gap-2 text-sm leading-relaxed">
      {clarification.pending && <p role="status">Explaining this question. Your answer stays in the editor.</p>}
      {clarification.explanation && <p className="whitespace-pre-wrap break-words">{clarification.explanation}</p>}
      {clarification.error && <p role="alert">{clarification.error}</p>}
      {clarification.subscriptionError && <p role="status">{clarification.subscriptionError}</p>}
      {(clarification.failed || clarification.error) && !clarification.pending && clarification.canRetry &&
        <Button variant="outline" disabled={disabled} onClick={() => void clarification.clarify(true)}>Retry clarification</Button>}
      {clarification.failed && !clarification.canRetry && <p>This question has reached its clarification retry limit.</p>}
    </div>}
  </div>
}
