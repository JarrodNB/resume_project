/**
 * Description: The two drag-and-drop pieces of Home's board: a job tile that can be picked up by
 * its grip, and a stage column that jobs can be dropped onto. They only handle the dragging;
 * HomePage decides what a drop does (it saves the job's new stage).
 * Index:
 *   - JOB_DRAG_TYPE, stageDropId, stageFromDropId: ids that link tiles to columns
 *   - DraggableJobTile: list item with a drag handle
 *   - StageDropColumn: board column that lights up while a job is over it
 */
import type { ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/react'
import { DragHandle } from '@/components/dnd/DragHandle'
import type { JobStage } from '@/features/jobs/jobStageLabels'
import { cn } from '@/lib/utils'

export const JOB_DRAG_TYPE = 'job'
const STAGE_DROP_PREFIX = 'stage:'

export function stageDropId(stage: JobStage) {
  return `${STAGE_DROP_PREFIX}${stage}`
}

/** The stage a drop target stands for, or null when the target is something else. */
export function stageFromDropId(id: unknown): JobStage | null {
  const text = String(id ?? '')
  return text.startsWith(STAGE_DROP_PREFIX) ? (text.slice(STAGE_DROP_PREFIX.length) as JobStage) : null
}

interface DraggableJobTileProps {
  jobId: string
  /** Names the job for the drag handle, e.g. "Engineer at Acme". */
  label: string
  className?: string
  children: ReactNode
}

/** A job tile; only its grip starts a drag, so the links inside keep working. */
export function DraggableJobTile({ jobId, label, className, children }: DraggableJobTileProps) {
  const { ref, handleRef, isDragging } = useDraggable({ id: jobId, type: JOB_DRAG_TYPE })
  return (
    <li ref={ref} className={cn(className, 'is-draggable', isDragging && 'is-dragging')}>
      <DragHandle handleRef={handleRef} label={label} className="job-tile-grip" />
      {children}
    </li>
  )
}

/** A board column that accepts job tiles. */
export function StageDropColumn({ stage, className, children, ...rest }: { stage: JobStage; className?: string; children: ReactNode; 'aria-labelledby': string }) {
  const { ref, isDropTarget } = useDroppable({ id: stageDropId(stage), accept: JOB_DRAG_TYPE })
  return (
    <section ref={ref} className={cn(className, isDropTarget && 'is-drop-target')} {...rest}>
      {children}
    </section>
  )
}
