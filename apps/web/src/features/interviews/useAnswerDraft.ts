/** Keep reviewed answer text in memory and hand each finished capture to it once.
 * Capture tickets belong to a session revision. Editing, clearing or starting another
 * capture invalidates older tickets, so late recognition cannot replace corrections.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Draft = { context: string; text: string }
type CaptureTicket = { context: string; base: string }

export function useAnswerDraft(context: string) {
  const [draft, setDraft] = useState<Draft>({ context, text: '' })
  const currentContext = useRef(context)
  useEffect(() => { currentContext.current = context }, [context])
  const capture = useRef<CaptureTicket | null>(null)
  const text = draft.context === context ? draft.text : ''
  const setText = useCallback((value: string) => {
    capture.current = null
    setDraft({ context, text: value })
  }, [context])
  const beginCapture = useCallback(() => {
    const ticket = { context, base: text }
    capture.current = ticket
    return ticket
  }, [context, text])
  const finishCapture = useCallback((ticket: CaptureTicket, transcript: string) => {
    if (capture.current !== ticket || ticket.context !== currentContext.current) return
    capture.current = null
    setDraft({ context: ticket.context, text: ticket.base ? `${ticket.base}\n\n${transcript}` : transcript })
  }, [])
  return { text, setText, beginCapture, finishCapture }
}
