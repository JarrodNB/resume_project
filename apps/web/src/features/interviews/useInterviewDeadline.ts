/** Rechecks a retained interview deadline without polling the server.
 * The visibility check also catches deadlines passed while the browser suspended timers.
 */
import { useEffect, useState } from 'react'

export function useInterviewDeadline(deadline: string | null | undefined) {
  const [observedAt, setObservedAt] = useState(Date.now)
  const cutoff = deadline ? Date.parse(deadline) : null
  useEffect(() => {
    if (cutoff === null || !Number.isFinite(cutoff)) return
    const check = () => setObservedAt(Date.now())
    const timer = window.setTimeout(check, Math.min(2_147_483_647, Math.max(0, cutoff - Date.now())))
    document.addEventListener('visibilitychange', check)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', check) }
  }, [cutoff])
  return cutoff !== null && (!Number.isFinite(cutoff) || cutoff <= observedAt)
}
