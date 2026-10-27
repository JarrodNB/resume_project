/** Home's "AI work in progress" strip: every piece of AI work still running, each linked to the
 * page that shows it, beside the legend of signal colors.
 *
 * While anything is running the strip checks again every few seconds (not while the tab is hidden),
 * and once more whenever the tab comes back into view. When a piece of work drops off the list it
 * has finished, so `onWorkFinished` lets Home reload the job board, whose next steps may have moved.
 */
import { useEffect, useRef } from 'react'
import { useQuery } from '@apollo/client/react'
import { Link } from 'react-router'
import { RUNNING_AI_TASKS_QUERY } from './homeOperations'
import { SignalDot, SignalLegend } from './NextStepSignal'

const POLL_MS = 5000

export function AiWorkStrip({ onWorkFinished }: { onWorkFinished: () => void }) {
  const { data, error, refetch, startPolling, stopPolling } = useQuery(RUNNING_AI_TASKS_QUERY, {
    fetchPolicy: 'cache-and-network',
    skipPollAttempt: () => document.hidden,
  })
  const running = data?.runningAiTasks ?? []
  const previousIds = useRef<Set<string> | null>(null)
  const ids = running.map((task) => task.id).join(',')

  useEffect(() => {
    if (!ids) { stopPolling(); return }
    startPolling(POLL_MS)
    return stopPolling
  }, [ids, startPolling, stopPolling])

  useEffect(() => {
    if (!data) return
    const current = new Set(ids ? ids.split(',') : [])
    const finished = previousIds.current && [...previousIds.current].some((id) => !current.has(id))
    previousIds.current = current
    if (finished) onWorkFinished()
  }, [data, ids, onWorkFinished])

  useEffect(() => {
    function checkWhenVisible() { if (!document.hidden) void refetch().catch(() => { /* The strip shows the query error. */ }) }
    document.addEventListener('visibilitychange', checkWhenVisible)
    return () => document.removeEventListener('visibilitychange', checkWhenVisible)
  }, [refetch])

  return (
    <section className="signal-strip" aria-labelledby="home-running-heading">
      <h2 id="home-running-heading">AI work in progress</h2>
      {running.length > 0 ? (
        <ul>
          {running.map((task) => (
            <li key={task.id}><Link to={task.destination} className="next-step"><SignalDot signal="ai" />{task.label}</Link></li>
          ))}
        </ul>
      ) : error && !data ? <p className="signal-strip-idle">Couldn’t check for running AI work</p>
        : data ? <p className="signal-strip-idle">Nothing running right now</p> : null}
      <SignalLegend />
    </section>
  )
}
