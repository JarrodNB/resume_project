/** Show saved career evidence automatically without changing the candidate's answer.
 * Blur is a recall aid: headings stay readable and each body can be revealed accessibly.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PRODUCT_NAME } from '@/lib/productName'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { useInterviewCareerReferences } from './useInterviewCareerReferences'

type Props = { ownerId: string; interviewId: string; message: InterviewSnapshotFragment['messages'][number]; disabled: boolean }

/** Reset local request/reveal state whenever the owner or exact saved prompt changes. */
export function InterviewCareerReferences(props: Props) {
  return <PromptReferences key={`${props.ownerId}:${props.interviewId}:${props.message.id}`} {...props} />
}

function PromptReferences({ ownerId, interviewId, message, disabled }: Props) {
  const preferenceKey = `${PRODUCT_NAME}:interview-reference-blur:${ownerId}`
  const [blur, setBlur] = useState(() => {
    try { return localStorage.getItem(preferenceKey) !== 'false' } catch { return true }
  })
  const guidance = useInterviewCareerReferences(interviewId, message.id, message.careerReferences)
  const requested = useRef(false)
  useEffect(() => {
    if (disabled || requested.current || guidance.pending || guidance.complete || guidance.failed || guidance.error) return
    requested.current = true
    void guidance.retrieve()
  }, [disabled, guidance])
  return <section className="grid min-w-0 gap-3 border-t pt-4" aria-label="Relevant career examples">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-medium">Relevant career examples</h3>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={blur} onChange={(event) => {
          const next = event.target.checked
          setBlur(next)
          try { localStorage.setItem(preferenceKey, String(next)) } catch { /* Keep the preference for this prompt when storage is unavailable. */ }
        }} />
        Blur reference text
      </label>
    </div>
    <p className="text-sm leading-relaxed text-muted-foreground">Saved details from your career library to help you recall your experience.</p>
    {guidance.pending && <p role="status" className="text-sm">Finding career examples. You can keep answering.</p>}
    {guidance.complete && !guidance.references.length && <p role="status" className="text-sm">No relevant saved examples found for this question.</p>}
    {guidance.references.length > 0 && <ul className="grid gap-3">
      {guidance.references.map((reference) => <ReferenceCard key={`${reference.sourceType}:${reference.sourceId}`} reference={reference} blur={blur} />)}
    </ul>}
    {guidance.error && <p role="alert" className="text-sm">{guidance.error}</p>}
    {guidance.subscriptionError && <p role="status" className="text-sm">{guidance.subscriptionError}</p>}
    {(guidance.failed || guidance.error) && !guidance.pending && guidance.canRetry &&
      <Button variant="outline" className="min-h-11 justify-self-start" disabled={disabled} onClick={() => void guidance.retrieve(true)}>Retry career examples</Button>}
    {guidance.failed && !guidance.canRetry && <p className="text-sm">This question has reached its career example retry limit. You can keep answering.</p>}
  </section>
}

type Reference = NonNullable<Props['message']['careerReferences']>['references'][number]
function ReferenceCard({ reference, blur }: { reference: Reference; blur: boolean }) {
  const [revealed, setRevealed] = useState(false)
  const bodyId = useId()
  const concealed = blur && !revealed
  return <li className="grid min-w-0 gap-2 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h4 className="min-w-0 break-words text-sm font-medium">{reference.title}</h4>
      {blur && <Button variant="ghost" className="min-h-11" aria-expanded={!concealed} aria-controls={bodyId}
        aria-label={`${concealed ? 'Reveal' : 'Hide'} ${reference.title}`} onClick={() => setRevealed(!revealed)}>{concealed ? 'Reveal' : 'Hide'}</Button>}
    </div>
    <p id={bodyId} aria-hidden={concealed} inert={concealed} className={`max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed${concealed ? ' pointer-events-none select-none blur-sm' : ''}`}>{reference.body}</p>
  </li>
}
