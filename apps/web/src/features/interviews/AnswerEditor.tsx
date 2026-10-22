/** Keep the candidate's reviewed text in browser memory until an explicit submission.
 * A rejected or ambiguous save keeps the draft available; the caller owns durable recovery.
 */
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface AnswerEditorProps {
  text: string
  onTextChange: (text: string) => void
  disabled: boolean
  capturing?: boolean
  onSubmit: (text: string) => Promise<boolean>
}

export function AnswerEditor({ text, onTextChange, disabled, capturing = false, onSubmit }: AnswerEditorProps) {
  const saving = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  async function submit() {
    if (saving.current || disabled || capturing || !text.trim() || text.length > 4_000) return
    saving.current = true
    setSubmitting(true)
    try { await onSubmit(text) }
    finally { saving.current = false; setSubmitting(false) }
  }
  return <div className="grid gap-3">
    <label className="grid gap-2 text-sm" htmlFor="interview-answer">Your answer
      <Textarea id="interview-answer" rows={5} maxLength={4_000} value={text} aria-invalid={text.length > 4_000} aria-describedby={text.length > 4_000 ? 'interview-answer-limit' : undefined}
        placeholder="Your answer will appear here as you speak. You may edit your audio here, or if you prefer, you can type out your answer"
        onChange={(event) => onTextChange(event.target.value)} disabled={disabled || submitting} />
    </label>
    {text.length > 4_000 && <p id="interview-answer-limit" role="alert" className="text-sm text-destructive">Shorten your answer to 4,000 characters before submitting.</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled || capturing || submitting || !text.trim() || text.length > 4_000} aria-busy={submitting} onClick={() => void submit()}>{submitting ? 'Submitting answer…' : 'Submit answer'}</Button>
      <Button variant="outline" disabled={disabled || submitting || !text} onClick={() => onTextChange('')}>Clear answer</Button>
    </div>
  </div>
}
