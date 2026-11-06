/**
 * The comparison on a job's Fit tab: progress, results, and retry controls, using the job page's
 * shared lifecycle. Once a comparison finishes, the summary leads and "How you match" stays as a
 * heading for screen readers only.
 */
import { RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { AiWaitingLine } from '@/components/AiWaitingLine'
import { ErrorAlert } from '@/components/ErrorAlert'
import { TransientAlert } from '@/components/TransientAlert'
import { AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { GapAnalysisResultView } from './GapAnalysisResultView'
import { parseGapAnalysisResult } from './parseGapAnalysisResult'
import type { SavedGapResponse } from './savedGapResponse'
import type { GapAnalysisTask, useGapAnalysis } from './useGapAnalysis'
export type { GapAnalysisTask } from './useGapAnalysis'

interface GapAnalysisCardProps {
  jobId: string
  comparison: ReturnType<typeof useGapAnalysis>
  gapResponses: SavedGapResponse[]
  dismissedRequirements: string[]
  /** False when the job has no description; the comparison needs one. Defaults to true. */
  hasDescription?: boolean
  /** False when neither requirements nor nice-to-haves have been saved. */
  hasRequirements?: boolean
  /** Opens the job's edit form so the user can add comparison inputs. */
  onAddDescription?: () => void
  onEditRequirements?: () => void
}

const COMPARING_CAPTIONS = [
  'Reading the job requirements',
  'Searching your career library',
  'Weighing each requirement against your evidence',
  'Writing up the comparison',
]

/** Displays the lifecycle owned by the page, so its writing controls see the same state. */
export function GapAnalysisCard({ jobId, comparison, gapResponses, dismissedRequirements, hasDescription = true, hasRequirements = true, onAddDescription, onEditRequirements }: GapAnalysisCardProps) {
  const { task, starting, errors, subscriptionError, start } = comparison
  const runButton = (currentTask: GapAnalysisTask | null) => (
    <RunButton task={currentTask} starting={starting} onRun={() => void start()} hasDescription={hasDescription} hasRequirements={hasRequirements} onAddDescription={onAddDescription} onEditRequirements={onEditRequirements} />
  )

  // Tell the user when a comparison they were waiting on finishes (adjust state during render).
  const [seen, setSeen] = useState({ id: task?.id ?? null, status: task?.status ?? null })
  const [finishedNotice, setFinishedNotice] = useState<string | null>(null)
  if (task && (seen.id !== task.id || seen.status !== task.status)) {
    setSeen({ id: task.id, status: task.status })
    if (seen.id === task.id && seen.status !== 'COMPLETED' && seen.status !== 'FAILED' && task.status === 'COMPLETED') setFinishedNotice(task.id)
  }

  const finished = task?.status === 'COMPLETED'

  return (
    <section className="grid gap-4">
      <div className={finished ? 'sr-only' : 'grid gap-1'}>
        <h2 className="text-xl font-extrabold tracking-[-0.01em]">How you match</h2>
        <p className="text-sm text-muted-foreground">
          Each requirement compared with your career library. Only what your library says counts.
        </p>
      </div>
      {finishedNotice && finishedNotice === task?.id && (
        <TransientAlert key={finishedNotice} role="status">
          <AlertDescription>Comparison finished. Your results are below.</AlertDescription>
        </TransientAlert>
      )}
      <ErrorAlert messages={errors} title="Couldn't start the comparison" />
      {subscriptionError && <ErrorAlert title="Couldn't follow the comparison" messages={[subscriptionError.message]} />}
      <GapAnalysisTaskView task={task} jobId={jobId} gapResponses={gapResponses} dismissedRequirements={dismissedRequirements} renderRunButton={runButton} />
    </section>
  )
}

/** Renders a task by status: none yet, running, failed, or completed. */
function GapAnalysisTaskView({
  task,
  jobId,
  gapResponses,
  dismissedRequirements,
  renderRunButton,
}: {
  task: GapAnalysisTask | null
  jobId: string
  gapResponses: SavedGapResponse[]
  dismissedRequirements: string[]
  renderRunButton: (task: GapAnalysisTask | null) => ReactNode
}) {
  if (!task) {
    return (
      <div className="grid gap-4">
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          You'll see each requirement marked met, partial, or missing, with the library evidence behind it. For gaps, you can add what you've really done, and the answers feed your resume. It takes about a minute.
        </p>
        {renderRunButton(null)}
      </div>
    )
  }

  if (task.status !== 'COMPLETED' && task.status !== 'FAILED') {
    return (
      <div className="grid gap-1">
        <AiWaitingLine captions={COMPARING_CAPTIONS} statusLabel="Comparing this job with your career library…" captionSeconds={6} />
        <p className="text-sm text-muted-foreground">This usually takes 20 to 40 seconds. You can leave this page; the result will be saved.</p>
      </div>
    )
  }

  if (task.status === 'FAILED') {
    return (
      <>
        <ErrorAlert title="The comparison failed" messages={[task.errorMessage ?? 'Something went wrong. Please try again.']} />
        {renderRunButton(task)}
      </>
    )
  }

  const analysis = parseGapAnalysisResult(task.result)
  if (!analysis) {
    return (
      <>
        <p className="text-muted-foreground">This comparison couldn't be displayed. Run it again.</p>
        {renderRunButton(task)}
      </>
    )
  }
  return (
    <GapAnalysisResultView
      jobId={jobId}
      analysis={analysis}
      responses={gapResponses}
      dismissedRequirements={dismissedRequirements}
      comparedNote={renderRunButton(task)}
    />
  )
}

/** "Compare" for a first run, "Try again" after a failure, "Compare again" with the last run's date. */
function RunButton({ task, starting, onRun, hasDescription, hasRequirements, onAddDescription, onEditRequirements }: {
  task: GapAnalysisTask | null; starting: boolean; onRun: () => void; hasDescription: boolean; hasRequirements: boolean; onAddDescription?: () => void; onEditRequirements?: () => void
}) {
  const label = !task ? 'Compare with my career library' : task.status === 'FAILED' ? 'Try again' : 'Compare again'
  const analyzedOn = task?.status === 'COMPLETED' && task.createdAt ? new Date(task.createdAt).toLocaleDateString() : null
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant={task ? 'outline' : 'default'} size={task ? 'sm' : 'default'} disabled={starting || !hasDescription || !hasRequirements} onClick={onRun}>
        {task && <RefreshCw />}
        {starting ? 'Starting…' : label}
      </Button>
      {!hasDescription && (
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          The comparison needs a job description.
          {onAddDescription && <Button type="button" variant="outline" size="sm" onClick={onAddDescription}>Add description</Button>}
        </span>
      )}
      {hasDescription && !hasRequirements && (
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Add requirements or nice-to-haves to this job before comparing. A description alone is not enough.
          {onEditRequirements && <Button type="button" variant="outline" size="sm" onClick={onEditRequirements}>Edit requirements</Button>}
        </span>
      )}
      {analyzedOn && (
        <span className="text-sm text-muted-foreground">
          Compared on {analyzedOn}. Run it again after you update your library.
        </span>
      )}
    </div>
  )
}
