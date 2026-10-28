/**
 * Description: Live status for a job-import AI task. Once the job is saved it opens the job, or
 * first shows warnings from result.scraped_job. Safe to reload at any point.
 * Index:
 *   - JobImportTaskPage: page component, with copy for the scrape and paste flows
 */
import type { ReactNode } from 'react'
import { CircleCheck, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { scrapedJobWarnings } from './scrapedJobWarnings'

/** Renders the task's current state, redirecting to the saved job when there's nothing to warn about. */
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
  if (warnings.length === 0) return <Navigate to={`/jobs/${jobId}`} replace />

  return (
    <StatusCard
      icon={<CircleCheck className="size-10 text-signal-done-text" />}
      title="Job saved"
      body="A few things to check before you rely on it:"
    >
      <ul className="grid max-w-md gap-2 text-left text-sm">
        {warnings.map((warning) => (
          <li key={warning} className="flex gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
            {warning}
          </li>
        ))}
      </ul>
      <Button asChild>
        <Link to={`/jobs/${jobId}`}>View job</Link>
      </Button>
    </StatusCard>
  )
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
