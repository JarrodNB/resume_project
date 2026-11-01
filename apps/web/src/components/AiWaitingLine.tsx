/**
 * Shows that AI work is under way while there is nothing to show yet.
 * A blue signal shuttles along a short line of stops while a caption changes every few
 * seconds, so the wait feels like work in motion instead of a frozen screen. The captions are
 * decoration only: screen readers hear one steady `statusLabel` instead of a new announcement
 * every few seconds. It does not track real progress.
 */
import { useEffect, useState } from 'react'

interface Props {
  /** Visible captions, shown once each in order; the last one stays. */
  captions: string[]
  /** The single message screen readers hear. */
  statusLabel: string
  captionSeconds?: number
}

export function AiWaitingLine({ captions, statusLabel, captionSeconds = 3.2 }: Props) {
  const [captionIndex, setCaptionIndex] = useState(0)
  // Walk through the captions once, then stay on the last one rather than looping back to the first.
  useEffect(() => {
    if (captionIndex >= captions.length - 1) return
    const timer = window.setTimeout(() => setCaptionIndex((index) => index + 1), captionSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [captionIndex, captions.length, captionSeconds])

  return <div className="ai-waiting">
    <div aria-hidden="true" className="ai-transit">
      <span className="ai-transit-stop" />
      <span className="ai-transit-stop" />
      <span className="ai-transit-stop" />
      <span className="ai-transit-runner"><span className="ai-transit-signal" /></span>
    </div>
    <p role="status" className="ai-waiting-caption">
      <span className="sr-only">{statusLabel}</span>
      <span key={captionIndex} aria-hidden="true" className="ai-waiting-phrase">{captions[Math.min(captionIndex, captions.length - 1)]}…</span>
    </p>
  </div>
}
