/**
 * Fills the gap between sending a chat message and the reply's first words with the shared
 * AI waiting line. Screen readers hear one steady "Preparing your reply…". After a few seconds
 * it also shows how long the wait has been, so a slow answer does not look frozen.
 */
import { useEffect, useState } from 'react'
import { AiWaitingLine } from '@/components/AiWaitingLine'

const waitingCaptions = [
  'Reading your message',
  'Thinking it through',
  'Pulling the details together',
  'Shaping a reply',
  'Still working on it. Careful answers can take a moment',
]
const showElapsedAfterSeconds = 5

export function ChatReplyWaiting() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return <>
    <AiWaitingLine captions={waitingCaptions} statusLabel="Preparing your reply…" />
    {seconds >= showElapsedAfterSeconds && <p aria-hidden="true" className="text-xs text-muted-foreground">
      Waiting {seconds}s. Replies that look up your saved details can take up to a minute.
    </p>}
  </>
}
