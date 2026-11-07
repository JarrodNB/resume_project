/** Home's "AI work in progress" strip: every piece of AI work still running, each linked to the
 * page that shows it, beside the legend of signal colors.
 *
 * It does not poll. Each listed task follows itself over the aiTaskUpdated subscription, which
 * sends the task's current state at once and then every change; when one stops being queued
 * (finished, failed, or waiting on the user) the list is fetched again. Work started in another
 * tab shows up when this tab comes back into view. When a piece of work drops off the list,
 * `onWorkFinished` lets Home reload the job board, whose next steps may have moved.
 */
import { Link } from 'react-router'
import { useRunningAiTasks } from './useRunningAiTasks'
import { RunningTaskSubscription } from './RunningTaskSubscription'
import { SignalDot, SignalLegend } from './NextStepSignal'

type RunningTask = { id: string; label: string; destination: string }

export function AiWorkStrip({ onWorkFinished }: { onWorkFinished: () => void }) {
  const { running, data, error, checkAgain } = useRunningAiTasks(onWorkFinished)

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
  return <li><RunningTaskSubscription id={task.id} onSettled={onSettled} /><Link to={task.destination} className="next-step"><SignalDot signal="ai" />{task.label}</Link></li>
}
