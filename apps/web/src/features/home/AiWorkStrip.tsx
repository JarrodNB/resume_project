/** Home's "AI work in progress" strip: every piece of AI work still running, each linked to the
 * page that shows it, beside the legend of signal colors.
 *
 * It does not poll. Each listed task follows itself over the aiTaskUpdated subscription, which
 * sends the task's current state at once and then every change; when one stops being queued
 * (finished, failed, or waiting on the user) the list is fetched again. Work started in another
 * tab shows up when this tab comes back into view. When a piece of work drops off the list,
 * `onWorkFinished` lets Home reload the job board, whose next steps may have moved.
 */
import { useEffect, useRef } from 'react'
import { useQuery } from '@apollo/client/react'
import { Link } from 'react-router'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { RUNNING_AI_TASKS_QUERY } from './homeOperations'
import { SignalDot, SignalLegend } from './NextStepSignal'

type RunningTask = { id: string; label: string; destination: string }

export function AiWorkStrip({ onWorkFinished }: { onWorkFinished: () => void }) {
  const { data, error, refetch } = useQuery(RUNNING_AI_TASKS_QUERY, { fetchPolicy: 'cache-and-network' })
  const running = data?.runningAiTasks ?? []
  const previousIds = useRef<Set<string> | null>(null)
  const ids = running.map((task) => task.id).join(',')
  const checkAgain = () => { void refetch().catch(() => { /* The strip shows the query error. */ }) }

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
            <RunningTaskItem key={task.id} task={task} onSettled={checkAgain} />
          ))}
        </ul>
      ) : error && !data ? <p className="signal-strip-idle">Couldn’t check for running AI work</p>
        : data ? <p className="signal-strip-idle">Nothing running right now</p> : null}
      <SignalLegend />
    </section>
  )
}

/** One running task, followed live; tells the strip once the task is no longer queued. */
function RunningTaskItem({ task, onSettled }: { task: RunningTask; onSettled: () => void }) {
  const { aiTask } = useAiTaskUpdates(task.id)
  const settled = aiTask !== null && aiTask.status !== 'QUEUED'
  const reported = useRef(false)
  useEffect(() => {
    if (settled && !reported.current) { reported.current = true; onSettled() }
  }, [settled, onSettled])
  return <li><Link to={task.destination} className="next-step"><SignalDot signal="ai" />{task.label}</Link></li>
}
