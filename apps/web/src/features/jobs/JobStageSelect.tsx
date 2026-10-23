/** Save a job's application stage immediately when it changes.
 * Explain the pending save while the selector is locked; failures allow retry.
 */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Label } from '@/components/ui/label'
import { JOB_STAGE_LABELS } from './jobStageLabels'
import { MOVE_JOB_TO_STAGE_MUTATION } from './jobsOperations'
import { useSaveJob } from './useSaveJob'

type JobStage = keyof typeof JOB_STAGE_LABELS

/** Saves a new stage as soon as the user picks one. The first move off Not applied records the date. */
export function JobStageSelect({ jobId, stage }: { jobId: string; stage: JobStage }) {
  const { save, busy, errors } = useSaveJob()

  return (
    <div className="grid gap-1">
      <Label htmlFor={`job-stage-${jobId}`}>Stage</Label>
      <select
        id={`job-stage-${jobId}`}
        className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        value={stage}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value
          if (next !== stage) void save(MOVE_JOB_TO_STAGE_MUTATION, { id: jobId, stage: next })
        }}
      >
        {Object.entries(JOB_STAGE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {busy && <p role="status" className="text-sm text-muted-foreground">Saving stage…</p>}
      <ErrorAlert title="Couldn't update the stage" messages={errors} />
    </div>
  )
}
