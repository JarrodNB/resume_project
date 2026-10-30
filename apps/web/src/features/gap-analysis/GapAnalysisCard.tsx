/** Shows comparison progress, results, and retry controls using the job page’s shared lifecycle. */
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { type ReactNode } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GapAnalysisResultView } from './GapAnalysisResultView'
import { parseGapAnalysisResult } from './parseGapAnalysisResult'
import type { SavedGapResponse } from './savedGapResponse'
import type { GapAnalysisTask, useGapAnalysis } from './useGapAnalysis'
export type { GapAnalysisTask } from './useGapAnalysis'

interface GapAnalysisCardProps {
  jobId: string
  comparison: ReturnType<typeof useGapAnalysis>
  gapResponses: SavedGapResponse[]
}

/** Displays the lifecycle owned by the page, so its writing controls see the same state. */
export function GapAnalysisCard({ jobId, comparison, gapResponses }: GapAnalysisCardProps) {
  const { task, starting, errors, subscriptionError, start } = comparison
  const runButton = (currentTask: GapAnalysisTask | null) => (
    <RunButton task={currentTask} starting={starting} onRun={() => void start()} />
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>How you match</CardTitle>
        <CardDescription>
          Each requirement compared with your career library. Only what your library says counts.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ErrorAlert messages={errors} title="Couldn't start the comparison" />
        {subscriptionError && <ErrorAlert title="Couldn't follow the comparison" messages={[subscriptionError.message]} />}
        <GapAnalysisTaskView task={task} jobId={jobId} gapResponses={gapResponses} renderRunButton={runButton} />
      </CardContent>
    </Card>
  )
}

/** Renders a task by status: none yet, running, failed, or completed. */
function GapAnalysisTaskView({
  task,
  jobId,
  gapResponses,
  renderRunButton,
}: {
  task: GapAnalysisTask | null
  jobId: string
  gapResponses: SavedGapResponse[]
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
      <p className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Comparing this job with your career library…
      </p>
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
  return (
    <>
      {analysis ? (
        <GapAnalysisResultView jobId={jobId} analysis={analysis} responses={gapResponses} />
      ) : (
        <p className="text-muted-foreground">This comparison couldn't be displayed. Run it again.</p>
      )}
      {renderRunButton(task)}
    </>
  )
}

/** "Compare" for a first run, "Try again" after a failure, "Compare again" with the last run's date. */
function RunButton({ task, starting, onRun }: { task: GapAnalysisTask | null; starting: boolean; onRun: () => void }) {
  const label = !task ? 'Compare with my career library' : task.status === 'FAILED' ? 'Try again' : 'Compare again'
  const analyzedOn = task?.status === 'COMPLETED' && task.createdAt ? new Date(task.createdAt).toLocaleDateString() : null
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant={task ? 'outline' : 'default'} size={task ? 'sm' : 'default'} disabled={starting} onClick={onRun}>
        {task && <RefreshCw />}
        {starting ? 'Starting…' : label}
      </Button>
      {analyzedOn && (
        <span className="text-sm text-muted-foreground">
          Compared on {analyzedOn}. Run it again after you update your library.
        </span>
      )}
    </div>
  )
}
