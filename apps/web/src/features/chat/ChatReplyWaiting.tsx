/**
 * Fills the gap between sending a chat message and the reply's first words.
 * A blue signal shuttles along a short line of stops while a caption changes every few
 * seconds, so the wait feels like work in motion instead of a frozen screen. The caption is
 * decoration only: screen readers hear one steady "Preparing your reply…" instead of a
 * new announcement every few seconds. It does not track real progress.
 */
import { useEffect, useState } from 'react'

const waitingCaptions = [
  'Reading your message',
  'Thinking it through',
  'Pulling the details together',
  'Shaping a reply',
  'Still working on it. Careful answers can take a moment',
]
const captionSeconds = 3.2

export function ChatReplyWaiting() {
  const [captionIndex, setCaptionIndex] = useState(0)
  // Walk through the captions once, then stay on the last one rather than looping back to "Reading".
  useEffect(() => {
    if (captionIndex >= waitingCaptions.length - 1) return
    const timer = window.setTimeout(() => setCaptionIndex((index) => index + 1), captionSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [captionIndex])

  return <div className="chat-waiting">
    <div aria-hidden="true" className="chat-transit">
      <span className="chat-transit-stop" />
      <span className="chat-transit-stop" />
      <span className="chat-transit-stop" />
      <span className="chat-transit-runner"><span className="chat-transit-signal" /></span>
    </div>
    <p role="status" className="chat-waiting-caption">
      <span className="sr-only">Preparing your reply…</span>
      <span key={captionIndex} aria-hidden="true" className="chat-waiting-phrase">{waitingCaptions[captionIndex]}…</span>
    </p>
  </div>
}
