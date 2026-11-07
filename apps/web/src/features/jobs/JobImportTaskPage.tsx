/**
 * Description: Live status for a job-import AI task. Once the job is saved it opens the job, passing
 * any warnings from result.scraped_job along for the job's "check" note. Safe to reload at any point.
 * Index:
 *   - JobImportTaskPage: page component, with copy for the scrape and paste flows
 */
import type { ReactNode } from 'react'
import { CircleX, LoaderCircle } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { scrapedJobWarnings } from './scrapedJobWarnings'

/** Renders the task's current state, opening the saved job once it exists. */
export function JobImportTaskPage({
  retryTo,
  retryLabel,
  progressTitle,
  progressBody,
}: {
  retryTo: string
  retryLabel: string
  progressTitle: string
  progressBody: string
}) {
  const { aiTaskId = '' } = useParams()
  const { aiTask, error } = useAiTaskUpdates(aiTaskId)

  if (error) return <ErrorAlert title="Couldn't load this job import" messages={[error.message]} />
  if (!aiTask) return <StatusCard icon={<Spinner />} title="Loading…" />

  if (aiTask.status === 'FAILED') {
    return (
      <StatusCard
        icon={<CircleX className="size-10 text-destructive" />}
        title="We couldn't add this job"
        body={aiTask.errorMessage ?? 'Something went wrong while reading the posting.'}
      >
        <Button asChild variant="outline">
          <Link to={retryTo}>{retryLabel}</Link>
        </Button>
      </StatusCard>
    )
  }

  const jobId = aiTask.job?.id
  if (aiTask.status !== 'COMPLETED' || !jobId) {
    return <StatusCard icon={<Spinner />} title={progressTitle} body={progressBody} />
  }

  const warnings = scrapedJobWarnings(aiTask.result)
  const jobImportCheck = warnings.length > 0 ? { jobId, warnings } : undefined
  return <Navigate to={`/jobs/${jobId}`} replace state={jobImportCheck && { jobImportCheck }} />
}

/** Centered card with an icon, title, optional explanation, and actions. */
function StatusCard({ icon, title, body, children }: { icon: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Add a job</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {icon}
          <div className="grid gap-1">
            <p className="text-lg font-medium">{title}</p>
            {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  )
}

/** Large spinning loader icon. */
function Spinner() {
  return <LoaderCircle className="size-10 animate-spin text-muted-foreground" />
}
