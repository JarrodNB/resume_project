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
  onSubmit: (text: string) => Promise<boolean>
}

export function AnswerEditor({ text, onTextChange, disabled, onSubmit }: AnswerEditorProps) {
  const saving = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  async function submit() {
    if (saving.current || disabled || !text.trim() || text.length > 4_000) return
    saving.current = true
    setSubmitting(true)
    try { await onSubmit(text) }
    finally { saving.current = false; setSubmitting(false) }
  }
  return <div className="grid gap-3">
    <label className="grid gap-2 text-sm" htmlFor="interview-answer">Your answer
      <Textarea id="interview-answer" rows={5} maxLength={4_000} value={text} aria-describedby="interview-answer-help"
        onChange={(event) => onTextChange(event.target.value)} disabled={disabled || submitting} />
    </label>
    <p id="interview-answer-help" className="text-sm text-muted-foreground">Type your answer and review it before submitting. Unsent text stays only in this tab.</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled || submitting || !text.trim() || text.length > 4_000} aria-busy={submitting} onClick={() => void submit()}>{submitting ? 'Submitting answer…' : 'Submit answer'}</Button>
      <Button variant="outline" disabled={disabled || submitting || !text} onClick={() => onTextChange('')}>Clear answer</Button>
    </div>
  </div>
}
