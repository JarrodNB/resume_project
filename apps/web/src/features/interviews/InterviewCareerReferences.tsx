/** Show saved career evidence automatically without changing the candidate's answer.
 * Each card names the career library section it came from, so the evidence stays traceable.
 * Blur is a recall aid: headings stay readable and each body can be revealed accessibly.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PRODUCT_NAME } from '@/lib/productName'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { useInterviewCareerReferences } from './useInterviewCareerReferences'

type Props = { ownerId: string; interviewId: string; message: InterviewSnapshotFragment['messages'][number]; disabled: boolean }

/** Matches the career library's section names; highlights belong to their role's Experience entry. */
const SOURCE_LABELS: Record<string, string> = {
  Experience: 'Experience', ExperienceHighlight: 'Experience', Project: 'Project', Education: 'Education',
  Certification: 'Certification', Skill: 'Skill', CareerContext: 'Career context',
}

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
  const count = guidance.references.length
  return <section className="interview-evidence" aria-label="Relevant career examples">
    <div className="interview-evidence-head">
      <div className="grid gap-1">
        <div className="interview-evidence-title-row">
          <h3 className="interview-evidence-title">Relevant career examples</h3>
          {count > 0 && <span className="interview-evidence-count">{count} found</span>}
        </div>
        <p className="interview-evidence-note">Saved details from your career library to help you recall your experience.</p>
      </div>
      <label className="interview-evidence-blur">
        <input type="checkbox" checked={blur} onChange={(event) => {
          const next = event.target.checked
          setBlur(next)
          try { localStorage.setItem(preferenceKey, String(next)) } catch { /* Keep the preference for this prompt when storage is unavailable. */ }
        }} />
        Blur reference text
      </label>
    </div>
    {guidance.pending && <p role="status" className="interview-evidence-state"><span className="signal-dot is-ai" aria-hidden="true" />Finding career examples. You can keep answering.</p>}
    {guidance.complete && !count && <p role="status" className="interview-evidence-state is-quiet"><span className="interview-evidence-stop" aria-hidden="true" />No relevant saved examples found for this question.</p>}
    {count > 0 && <ul className="interview-evidence-list">
      {guidance.references.map((reference) => <ReferenceCard key={`${reference.sourceType}:${reference.sourceId}`} reference={reference} blur={blur} />)}
    </ul>}
    {guidance.error && <p role="alert" className="interview-evidence-state is-action"><span className="signal-dot is-action" aria-hidden="true" />{guidance.error}</p>}
    {guidance.subscriptionError && <p role="status" className="interview-evidence-state is-quiet">{guidance.subscriptionError}</p>}
    {(guidance.failed || guidance.error) && !guidance.pending && guidance.canRetry &&
      <Button variant="outline" className="interview-evidence-retry" disabled={disabled} onClick={() => void guidance.retrieve(true)}>Retry career examples</Button>}
    {guidance.failed && !guidance.canRetry && <p className="interview-evidence-state is-quiet">This question has reached its career example retry limit. You can keep answering.</p>}
  </section>
}

type Reference = NonNullable<Props['message']['careerReferences']>['references'][number]
function ReferenceCard({ reference, blur }: { reference: Reference; blur: boolean }) {
  const [revealed, setRevealed] = useState(false)
  const bodyId = useId()
  const concealed = blur && !revealed
  const source = SOURCE_LABELS[reference.sourceType]
  return <li className="interview-evidence-item">
    <div className="interview-evidence-item-head">
      <div className="grid min-w-0 gap-0.5">
        {source && <p className="interview-evidence-source">{source}</p>}
        <h4 className="interview-evidence-item-title">{reference.title}</h4>
      </div>
      {blur && <Button variant="outline" size="sm" className="interview-evidence-reveal" aria-expanded={!concealed} aria-controls={bodyId}
        aria-label={`${concealed ? 'Reveal' : 'Hide'} ${reference.title}`} onClick={() => setRevealed(!revealed)}>
        {concealed ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}{concealed ? 'Reveal' : 'Hide'}
      </Button>}
    </div>
    <p id={bodyId} aria-hidden={concealed} inert={concealed} data-concealed={concealed} className="interview-evidence-body">{reference.body}</p>
  </li>
}
