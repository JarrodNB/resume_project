/**
 * Description: The job page's gap analysis card. Shows the job's latest analysis, starts a new one,
 * and follows a running one live over the aiTaskUpdated subscription (also after a reload).
 * Index:
 *   - GapAnalysisTask: the task fields the card needs
 *   - GapAnalysisCard: card component
 */
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { AiTaskStatusEnum } from '@/graphql/generated/graphql'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { GapAnalysisResultView } from './GapAnalysisResultView'
import { parseGapAnalysisResult } from './parseGapAnalysisResult'
import type { SavedGapResponse } from './savedGapResponse'
import { useStartGapAnalysis } from './useStartGapAnalysis'

export interface GapAnalysisTask {
  id: string
  status: AiTaskStatusEnum
  result: unknown
  errorMessage: string | null
  createdAt: string
}

interface GapAnalysisCardProps {
  jobId: string
  latestGapAnalysis: GapAnalysisTask | null
  gapResponses: SavedGapResponse[]
}

/** Compares the job with the career library on request and shows the outcome. */
export function GapAnalysisCard({ jobId, latestGapAnalysis, gapResponses }: GapAnalysisCardProps) {
  const { startGapAnalysis, starting, errors } = useStartGapAnalysis(jobId)
  const [startedTaskId, setStartedTaskId] = useState<string | null>(null)
  const followedTaskId = startedTaskId ?? (latestGapAnalysis?.status === 'QUEUED' ? latestGapAnalysis.id : null)

  async function runAnalysis() {
    const aiTaskId = await startGapAnalysis()
    if (aiTaskId) setStartedTaskId(aiTaskId)
  }

  const runButton = (task: GapAnalysisTask | null) => (
    <RunButton task={task} starting={starting} onRun={() => void runAnalysis()} />
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
        {followedTaskId ? (
          <FollowedGapAnalysis
            key={followedTaskId}
            aiTaskId={followedTaskId}
            jobId={jobId}
            gapResponses={gapResponses}
            renderRunButton={runButton}
          />
        ) : (
          <GapAnalysisTaskView task={latestGapAnalysis} jobId={jobId} gapResponses={gapResponses} renderRunButton={runButton} />
        )}
      </CardContent>
    </Card>
  )
}

/** Follows a task live; shows it as running until the first update arrives. */
function FollowedGapAnalysis({
  aiTaskId,
  jobId,
  gapResponses,
  renderRunButton,
}: {
  aiTaskId: string
  jobId: string
  gapResponses: SavedGapResponse[]
  renderRunButton: (task: GapAnalysisTask | null) => ReactNode
}) {
  const { aiTask, error } = useAiTaskUpdates(aiTaskId)
  if (error) return <ErrorAlert title="Couldn't follow the comparison" messages={[error.message]} />
  const task: GapAnalysisTask = aiTask ?? { id: aiTaskId, status: 'QUEUED', result: null, errorMessage: null, createdAt: '' }
  return <GapAnalysisTaskView task={task} jobId={jobId} gapResponses={gapResponses} renderRunButton={renderRunButton} />
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
  if (!task) return renderRunButton(null)

  if (task.status === 'QUEUED') {
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
