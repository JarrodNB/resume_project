/** Play an answer directly from browser memory. Its private URL lives only as long
 * as this preview; playback errors leave submission and re-recording available.
 */
import { useEffect, useState } from 'react'

export function RecordingReview({ recording }: { recording: Blob }) {
  const [source, setSource] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    // The source is a browser resource acquired here and revoked by this effect.
    // oxlint-disable-next-line react/set-state-in-effect
    setFailed(false)
    try {
      const url = URL.createObjectURL(recording)
      setSource(url)
      return () => URL.revokeObjectURL(url)
    } catch { setSource(undefined); setFailed(true) }
  }, [recording])
  return <div className="grid gap-2">
    <p className="text-sm">Listen to your recording before submitting.</p>
    {source && <audio aria-label="Your recording preview" controls src={source} onError={() => setFailed(true)} />}
    {failed && <p role="alert">This browser could not play your recording. You can still submit it or re-record.</p>}
  </div>
}
