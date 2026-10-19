/**
 * Description: Page for one parse_resume task (/import/:aiTaskId). Follows the task live and shows
 * its status, then the review form once parsing completes. Safe to reload at any point.
 * Index:
 *   - ResumeImportTaskPage: page component
 */
import { useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { ParsedResumeReview } from './ParsedResumeReview'
import { parsedResumeFromTaskResult } from './parsedResume'
import { ParseTaskStatusCard } from './ParseTaskStatusCard'

/** Renders the right step for the task's current state. */
export function ResumeImportTaskPage() {
  const { aiTaskId = '' } = useParams()
  const { aiTask, error } = useAiTaskUpdates(aiTaskId)
  const parsedResume = aiTask?.status === 'COMPLETED' ? parsedResumeFromTaskResult(aiTask.result) : null

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Review your resume</h1>
        <p className="text-muted-foreground">Check what we found and fix anything that's off before importing.</p>
      </div>
      {error ? (
        <ErrorAlert title="Couldn't load this import" messages={[error.message]} />
      ) : !aiTask ? (
        <ParseTaskStatusCard status="connecting" />
      ) : aiTask.acceptedAt ? (
        <ParseTaskStatusCard status="imported" />
      ) : aiTask.status === 'FAILED' ? (
        <ParseTaskStatusCard status="failed" errorMessage={aiTask.errorMessage} />
      ) : parsedResume ? (
        <ParsedResumeReview key={aiTask.id} aiTaskId={aiTask.id} parsedResume={parsedResume} />
      ) : aiTask.status === 'NEEDS_USER_INPUT' || aiTask.status === 'COMPLETED' ? (
        <ParseTaskStatusCard
          status="failed"
          errorMessage="We couldn't prepare a resume to review. Please upload the file again."
        />
      ) : (
        <ParseTaskStatusCard status="parsing" />
      )}
    </div>
  )
}
