/** Float question-only explanations outside the toolbar so feedback never reflows its controls.
 * The panel is non-modal; the answer editor stays independent and Escape returns to its trigger.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { useInterviewClarification } from './useInterviewClarification'

type Props = { interviewId: string; message: InterviewSnapshotFragment['messages'][number]; disabled: boolean }

export function InterviewClarification({ interviewId, message, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const clarification = useInterviewClarification(interviewId, message.id, message.clarification)
  return <Popover open={open} onOpenChange={(value) => {
    setOpen(value)
    if (value && !clarification.failed) void clarification.clarify()
  }}>
    <PopoverTrigger asChild><Button variant="outline" disabled={disabled} aria-busy={clarification.pending}>Clarify question</Button></PopoverTrigger>
    <PopoverContent aria-label="Question clarification" align="start" collisionPadding={16}
      className="grid w-80 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto p-4 text-left leading-relaxed"
      style={{ maxHeight: 'min(24rem, var(--radix-popover-content-available-height))' }}>
      <div className="flex items-center justify-between gap-3"><h3 className="font-medium">Question clarification</h3><Button variant="ghost" className="min-h-11" aria-label="Close clarification" onClick={() => setOpen(false)}>Close</Button></div>
      {clarification.pending && <p role="status">Explaining this question. Your answer stays in the editor.</p>}
      {clarification.explanation && <p className="whitespace-pre-wrap break-words">{clarification.explanation}</p>}
      {clarification.error && <p role="alert">{clarification.error}</p>}
      {clarification.subscriptionError && <p role="status">{clarification.subscriptionError}</p>}
      {(clarification.failed || clarification.error) && !clarification.pending && clarification.canRetry &&
        <Button variant="outline" disabled={disabled} onClick={() => void clarification.clarify(true)}>Retry clarification</Button>}
      {clarification.failed && !clarification.canRetry && <p>This question has reached its clarification retry limit.</p>}
    </PopoverContent>
  </Popover>
}
