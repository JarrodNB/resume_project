/** The job workspace's resume: the saved resume, a draft in progress, or a way to start one.
 *
 * The Resume tab (`/jobs/:id/resume`) only shows what exists; it never starts paid generation.
 * The write route (`/jobs/:id/resume/write`) starts a whole-draft tailor task when there isn't
 * one, follows it live, and returns to the Resume tab once the draft is saved.
 */
import { FileText, LoaderCircle } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useJobWorkspace } from '@/features/jobs/useJobWorkspace'
import { WriteResumeAction } from '@/features/jobs/WriteResumeAction'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { FinalResumeEditor } from './FinalResumeEditor'
import { finishedSectionsFromResult, warningsFromResult } from './parseTailorTask'
import { SavedResumeEditor } from './SavedResumeEditor'
import { useResumeTailoring } from './useResumeTailoring'
import { useTailorActions } from './useTailorActions'

/** Shows the saved resume or a draft in progress, or offers to write one. */
export function JobResumeTab() {
  return <JobResume autoStart={false} />
}

/** Starts writing a resume for this job (or follows the draft already being written). */
export function WriteJobResumePage() {
  return <JobResume autoStart />
}

function JobResume({ autoStart }: { autoStart: boolean }) {
  const { job: workspaceJob, comparison } = useJobWorkspace()
  const id = workspaceJob.id
  const navigate = useNavigate()
  const { job, task, loading, error, startErrors, subscriptionError, retry, refetch } = useResumeTailoring(id, { autoStart })
  const actions = useTailorActions(task?.id ?? '', () => {
    void refetch()
    if (autoStart) void navigate(`/jobs/${id}/resume`, { replace: true })
  })
  const resumeTab = `/jobs/${id}/resume`

  // The write route is only for starting or following a draft; a saved resume lives on the tab.
  if (autoStart && job?.resume) return <Navigate to={resumeTab} replace />

  return (
    <div className="resume-page grid w-full gap-6">
      {error && <ErrorAlert title="Couldn't load this resume" messages={[requestErrorMessage(error, error.message)]} />}
      {subscriptionError && <ErrorAlert title="Couldn't follow the resume" messages={[subscriptionError.message]} />}
      <ErrorAlert messages={startErrors} title="Couldn't start the resume" />
      {job && !job.resume && startErrors.length > 0 && !task && (
        <Button type="button" variant="outline" className="justify-self-start" onClick={retry}>Try again</Button>
      )}
      {!job && loading && (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      )}
      {job?.resume && <h2 className="text-lg font-medium break-words">{job.resume.title}</h2>}
      {job?.resume && <SavedResumeEditor key={job.resume.id} resumeId={job.resume.id} title={job.resume.title} sections={job.resume.sections} jobId={id} onDeleted={() => void navigate(resumeTab)} />}
      {job && !job.resume && task?.status === 'FAILED' && (
        <Card>
          <CardContent className="grid gap-4">
            <ErrorAlert title="The resume couldn't be written" messages={[task.errorMessage ?? 'Something went wrong. Please try again.']} />
            <Button type="button" variant="outline" className="justify-self-start" onClick={retry}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}
      {job && !job.resume && task && task.status !== 'FAILED' && task.acceptedAt === null && (
        <TailorProgress jobId={id} task={task} actions={actions} onRetry={retry} />
      )}
      {job && !job.resume && !task && !autoStart && startErrors.length === 0 && (
        <div className="empty-records">
          <FileText size={28} strokeWidth={1.6} aria-hidden />
          <h2>No resume for this job yet</h2>
          <p>Write a complete draft from your career library. You review and edit every section before it's saved.</p>
          <WriteResumeAction
            jobId={id}
            resumeId={null}
            comparisonFinished={comparison.completed}
            comparisonBusy={comparison.busy}
            onCompare={() => void comparison.start()}
          />
        </div>
      )}
    </div>
  )
}

/** A whole-draft loading message or the completed editor. */
function TailorProgress({
  jobId,
  task,
  actions,
  onRetry,
}: {
  jobId: string
  task: NonNullable<ReturnType<typeof useResumeTailoring>['task']>
  actions: ReturnType<typeof useTailorActions>
  onRetry: () => void
}) {
  if (task.status === 'COMPLETED') {
    const sections = finishedSectionsFromResult(task.result)
    if (sections.length === 0) {
      return (
        <Card>
          <CardContent className="grid gap-4">
            <ErrorAlert title="The draft couldn't be opened" messages={['This result has no editable resume sections. Generate a new draft.']} />
            <Button type="button" variant="outline" className="justify-self-start" onClick={onRetry}>Generate again</Button>
          </CardContent>
        </Card>
      )
    }
    return (
      <FinalResumeEditor
        key={task.id}
        jobId={jobId}
        sections={sections}
        warnings={warningsFromResult(task.result)}
        pending={actions.pending}
        errors={actions.errors}
        onSave={actions.saveResume}
      />
    )
  }

  return (
    <Card className="border-dashed bg-transparent shadow-none">
      <CardContent className="grid gap-2">
        <p className="flex items-center gap-2 font-medium" role="status">
          <LoaderCircle className="size-4 animate-spin text-section-skills-accent" aria-hidden /> Writing your complete draft…
        </p>
        <p className="text-sm text-muted-foreground">Your sections will appear together when the draft is ready to review. You can leave this page; we'll notify you when it's done.</p>
      </CardContent>
    </Card>
  )
}
