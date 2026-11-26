/** Keep the candidate's reviewed text in browser memory until it is submitted.
 * Submission is explicit, or in hands-free mode follows a short "Sending in 3…" countdown that the
 * candidate can stop (Keep editing) or skip (Send now); both use the same submit as the button.
 * A rejected or ambiguous save keeps the draft available; the caller owns durable recovery.
 */
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface AnswerEditorProps {
  recordingControls?: ReactNode
  text: string
  onTextChange: (text: string) => void
  disabled: boolean
  capturing?: boolean
  onSubmit: (text: string) => Promise<boolean>
  /** Hands-free mode: show the auto-send countdown for the current text. */
  autoSend?: boolean
  /** Called when the countdown ends for any reason: sent, Send now, or Keep editing. */
  onAutoSendEnd?: () => void
}

const AUTO_SEND_SECONDS = 3

/** Count down out loud for screen readers, then send. The buttons stay outside the live region so only the count is announced. */
function AutoSendCountdown({ onSend, onKeepEditing }: { onSend: () => void; onKeepEditing: () => void }) {
  const [remaining, setRemaining] = useState(AUTO_SEND_SECONDS)
  const sendRef = useRef(onSend)
  useEffect(() => { sendRef.current = onSend }, [onSend])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (remaining > 1) setRemaining(remaining - 1)
      else sendRef.current()
    }, 1000)
    return () => clearTimeout(timer)
  }, [remaining])
  return <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 [&_button]:min-h-11">
    <p aria-live="polite" className="text-sm font-medium">Sending in {remaining}…</p>
    <Button variant="outline" onClick={onKeepEditing}>Keep editing</Button>
    <Button onClick={onSend}>Send now</Button>
  </div>
}

export function AnswerEditor({ recordingControls, text, onTextChange, disabled, capturing = false, onSubmit, autoSend = false, onAutoSendEnd }: AnswerEditorProps) {
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
        placeholder="Your answer will appear here as you speak. Review and edit the text here, or type your answer."
        onChange={(event) => onTextChange(event.target.value)} disabled={disabled || submitting} />
    </label>
    {autoSend && !disabled && text.trim() && !submitting && <AutoSendCountdown onKeepEditing={() => onAutoSendEnd?.()} onSend={() => { onAutoSendEnd?.(); void submit() }} />}
    {text.length > 4_000 && <p id="interview-answer-limit" role="alert" className="text-sm text-destructive">Shorten your answer to 4,000 characters before submitting.</p>}
    <div role="group" aria-label="Answer controls" className="flex flex-wrap items-center gap-3 [&_button]:min-h-11">
      {recordingControls}
      <Button disabled={disabled || capturing || submitting || !text.trim() || text.length > 4_000} aria-busy={submitting} onClick={() => void submit()}>{submitting ? 'Submitting answer…' : 'Submit answer'}</Button>
      <Button variant="outline" disabled={disabled || submitting || !text} onClick={() => onTextChange('')}>Clear answer</Button>
    </div>
  </div>
}
