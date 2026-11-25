/** The Jobs board: one column per stage, each job a tile you can drag to another stage.
 *
 * Lives on the Jobs page (not Home) because a board only suits a modest number of jobs. Each
 * column shows its first few tiles and a "Show more" button for the rest, so a long search stays
 * scannable. Dropping a tile saves its new stage right away (like the stage picker on the job
 * page); the tile shows in its new column while that saves and snaps back if the save fails.
 */
import { useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { ArchiveHomeJobButton } from '@/features/home/ArchiveHomeJobButton'
import { JOB_PIPELINE_QUERY } from '@/features/home/homeOperations'
import type { PipelineEntry } from '@/features/home/homeSummary'
import { NextStep } from '@/features/home/NextStepSignal'
import { DraggableJobTile, StageDropColumn, stageFromDropId } from '@/features/home/PipelineDragParts'
import { PipelineJobName } from '@/features/home/PipelineJobName'
import { cn } from '@/lib/utils'
import { JobStopLine } from './JobStopLine'
import { JOB_STAGE_LABELS, JOB_STAGE_ORDER, type JobStage } from './jobStageLabels'
import { JOBS_QUERY, MOVE_JOB_TO_STAGE_MUTATION } from './jobsOperations'
import { useSaveJob } from './useSaveJob'

/** How many tiles a column shows before "Show more". */
export const BOARD_COLUMN_LIMIT = 8

export function JobsBoard({ entries }: { entries: PipelineEntry[] }) {
  const { save, busy, errors, clearErrors } = useSaveJob()
  const [movingTo, setMovingTo] = useState<Record<string, JobStage>>({})
  const [expanded, setExpanded] = useState<Set<JobStage>>(new Set())
  const shown = entries.map((entry) => (movingTo[entry.job.id] ? { ...entry, job: { ...entry.job, stage: movingTo[entry.job.id] } } : entry))

  async function moveJob(jobId: string, stage: JobStage) {
    setMovingTo((current) => ({ ...current, [jobId]: stage }))
    await save(MOVE_JOB_TO_STAGE_MUTATION, { id: jobId, stage }, [JOB_PIPELINE_QUERY, JOBS_QUERY])
    setMovingTo(({ [jobId]: _settled, ...rest }) => rest)
  }

  return (
    <DragDropProvider
      onDragStart={clearErrors}
      onDragEnd={(event) => {
        const stage = stageFromDropId(event.operation.target?.id)
        const jobId = String(event.operation.source?.id ?? '')
        const current = shown.find((entry) => entry.job.id === jobId)?.job.stage
        if (!event.canceled && stage && current && stage !== current && !busy) void moveJob(jobId, stage)
      }}
    >
      <ErrorAlert title="Couldn't move that job" messages={errors} />
      <div className="pipeline-board">
        {JOB_STAGE_ORDER.map((stage) => {
          const inStage = shown.filter((entry) => entry.job.stage === stage)
          // A tile that was just dropped here stays on top, so it never lands behind "Show more".
          const ordered = [...inStage.filter((entry) => movingTo[entry.job.id]), ...inStage.filter((entry) => !movingTo[entry.job.id])]
          const visible = expanded.has(stage) ? ordered : ordered.slice(0, BOARD_COLUMN_LIMIT)
          const hidden = ordered.length - visible.length
          const headingId = `board-${stage.toLowerCase()}`
          return (
            <StageDropColumn key={stage} stage={stage} className={cn('pipeline-column', stage === 'OFFER' && 'is-offer', stage === 'REJECTED' && 'is-rejected')} aria-labelledby={headingId}>
              <div className="station">
                <span className="station-bullet" aria-hidden>{inStage.length}</span>
                <h2 id={headingId}>{JOB_STAGE_LABELS[stage]}<span className="sr-only">, {inStage.length === 1 ? '1 job' : `${inStage.length} jobs`}</span></h2>
                {stage === 'REJECTED' && <small className="station-note">Branch line</small>}
              </div>
              {visible.length > 0 ? (
                <ul>
                  {visible.map((entry) => (
                    <DraggableJobTile
                      key={entry.job.id}
                      jobId={entry.job.id}
                      label={`${entry.job.title} at ${entry.job.company ?? 'an unknown company'}`}
                      className={cn('job-tile', stage === 'REJECTED' && 'is-closed')}
                    >
                      <PipelineJobName entry={entry} />
                      <JobStopLine stage={stage} />
                      <div className="next-step-row flex items-center justify-between gap-2">
                        <NextStep entry={entry} />
                        <ArchiveHomeJobButton jobId={entry.job.id} title={entry.job.title} />
                      </div>
                    </DraggableJobTile>
                  ))}
                </ul>
              ) : <p className="pipeline-empty">No jobs</p>}
              {hidden > 0 && (
                <Button variant="outline" onClick={() => setExpanded((current) => new Set(current).add(stage))}>
                  Show {hidden} more <span className="sr-only">{JOB_STAGE_LABELS[stage]} jobs</span>
                </Button>
              )}
            </StageDropColumn>
          )
        })}
      </div>
    </DragDropProvider>
  )
}
