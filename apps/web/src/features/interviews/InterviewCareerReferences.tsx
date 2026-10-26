/** Show exact saved career evidence near the current question, independently of answer controls.
 * The disclosure stays closed until requested; no reference is inserted into the candidate's answer.
 */
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { useInterviewCareerReferences } from './useInterviewCareerReferences'

type Props = { interviewId: string; message: InterviewSnapshotFragment['messages'][number]; disabled: boolean }

export function InterviewCareerReferences({ interviewId, message, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const guidance = useInterviewCareerReferences(interviewId, message.id, message.careerReferences)
  return <section className="grid gap-3 border-t pt-4" aria-label="Relevant career examples">
    <Button variant="outline" className="min-h-11 justify-self-start" disabled={disabled} aria-expanded={open} aria-controls={panelId}
      onClick={() => {
        setOpen(!open)
        if (!open && !guidance.failed) void guidance.retrieve()
      }}>{open ? 'Hide career examples' : 'Show career examples'}</Button>
    {open && <div id={panelId} className="grid min-w-0 gap-3">
      <h3 className="font-medium">Relevant career examples</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">Saved details from your career library to help you recall your experience.</p>
      {guidance.pending && <p role="status" className="text-sm">Finding career examples. You can keep answering.</p>}
      {guidance.complete && !guidance.references.length && <p role="status" className="text-sm">No relevant saved examples found for this question.</p>}
      {guidance.references.length > 0 && <ul className="grid gap-3">
        {guidance.references.map((reference) => <li key={`${reference.sourceType}:${reference.sourceId}`} className="grid min-w-0 gap-2 border-t pt-3">
          <h4 className="break-words text-sm font-medium">{reference.title}</h4>
          <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{reference.body}</p>
        </li>)}
      </ul>}
      {guidance.error && <p role="alert" className="text-sm">{guidance.error}</p>}
      {guidance.subscriptionError && <p role="status" className="text-sm">{guidance.subscriptionError}</p>}
      {(guidance.failed || guidance.error) && !guidance.pending && guidance.canRetry &&
        <Button variant="outline" className="min-h-11 justify-self-start" disabled={disabled} onClick={() => void guidance.retrieve(true)}>Retry career examples</Button>}
      {guidance.failed && !guidance.canRetry && <p className="text-sm">This question has reached its career example retry limit. You can keep answering.</p>}
    </div>}
  </section>
}
