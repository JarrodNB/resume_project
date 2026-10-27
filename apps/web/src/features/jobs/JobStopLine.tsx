/** A job's own line through the application stages, like a single transit route.
 *
 * Stops the job has passed are filled and its current stop is ringed; a rejected job's line goes
 * gray. The dots are decorative, so the stage name is given as text (visible or screen-reader only).
 */
import { cn } from '@/lib/utils'
import { JOB_STAGE_LABELS, JOB_STAGE_ORDER, type JobStage } from './jobStageLabels'

export function JobStopLine({ stage, showLabel = false, className }: { stage: JobStage; showLabel?: boolean; className?: string }) {
  const current = JOB_STAGE_ORDER.indexOf(stage)
  const closed = stage === 'REJECTED'
  return (
    <div className={cn('job-stop-line', closed && 'is-closed', className)}>
      <div className="stop-line" aria-hidden>
        {JOB_STAGE_ORDER.map((stop, index) => (
          <i key={stop} className={cn('stop', index === current ? 'is-now' : index < current && !closed && 'is-done')} />
        ))}
      </div>
      <span className={showLabel ? 'job-stop-label' : 'sr-only'}>{JOB_STAGE_LABELS[stage]}</span>
    </div>
  )
}
