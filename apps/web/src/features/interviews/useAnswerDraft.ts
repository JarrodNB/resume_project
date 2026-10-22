/** Keep live dictation and manual edits together in the answer box.
 * Capture tickets belong to a session revision. Editing protects the words already
 * shown; later recognition can add new words without replacing those corrections.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Draft = { context: string; text: string }
type CaptureTicket = { context: string; base: string; transcript: string; protectedTranscript: string | null }

// Match the dictated words present at the last edit against the latest recognition.
// This keeps earlier recognition revisions out of the protected text, while letting
// words spoken since that edit continue to arrive at the end of the answer.
function newDictation(protectedTranscript: string, transcript: string) {
  const previous = protectedTranscript.match(/\S+/gu) ?? []
  const incoming = transcript.match(/\S+/gu) ?? []
  const normalize = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const oldWords = previous.map(normalize)
  const newWords = incoming.map(normalize)
  const lengths = Array.from({ length: oldWords.length + 1 }, () => new Uint16Array(newWords.length + 1))
  for (let i = oldWords.length - 1; i >= 0; i--) {
    for (let j = newWords.length - 1; j >= 0; j--) {
      lengths[i][j] = oldWords[i] === newWords[j] ? 1 + lengths[i + 1][j + 1] : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  let i = 0, j = 0, boundary = 0, matched = 0
  while (i < oldWords.length && j < newWords.length) {
    if (oldWords[i] === newWords[j]) { i++; j++; boundary = j; matched = i }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++
    else j++
  }
  // Unmatched old ending words were revised, rather than newly dictated.
  boundary = Math.min(incoming.length, boundary + oldWords.length - matched)
  return incoming.slice(boundary).join(' ')
}

function captureText(ticket: CaptureTicket, transcript: string) {
  if (ticket.protectedTranscript !== null) {
    const tail = newDictation(ticket.protectedTranscript, transcript)
    return tail ? `${ticket.base}${ticket.base && !/\s$/u.test(ticket.base) ? ' ' : ''}${tail}` : ticket.base
  }
  return ticket.base ? `${ticket.base}\n\n${transcript}` : transcript
}

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
  const editCapture = useCallback((value: string) => {
    const ticket = capture.current
    if (ticket && ticket.context === context) {
      ticket.base = value
      ticket.protectedTranscript = ticket.transcript
    }
    setDraft({ context, text: value })
  }, [context])
  const beginCapture = useCallback(() => {
    const ticket: CaptureTicket = { context, base: text, transcript: '', protectedTranscript: null }
    capture.current = ticket
    return ticket
  }, [context, text])
  const previewCapture = useCallback((ticket: CaptureTicket, transcript: string) => {
    if (capture.current !== ticket || ticket.context !== currentContext.current) return
    ticket.transcript = transcript
    setDraft({ context: ticket.context, text: captureText(ticket, transcript) })
  }, [])
  const finishCapture = useCallback((ticket: CaptureTicket, transcript: string) => {
    if (capture.current !== ticket || ticket.context !== currentContext.current) return
    capture.current = null
    setDraft({ context: ticket.context, text: captureText(ticket, transcript) })
  }, [])
  return { text, setText, editCapture, beginCapture, previewCapture, finishCapture }
}
