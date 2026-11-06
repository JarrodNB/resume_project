/** The job workspace's resume: the saved resume, a draft in progress, or a way to start one.
 *
 * The Resume tab (`/jobs/:id/resume`) only shows what exists; it never starts paid generation.
 * The write route (`/jobs/:id/resume/write`) asks the user to confirm (and needs a job
 * description) before it starts a whole-draft tailor task when there isn't one, follows it live,
 * and returns to the Resume tab once the draft is saved.
 */
import { ContentSkeleton } from '@/components/ContentSkeleton'
import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router'
import { AiWaitingLine } from '@/components/AiWaitingLine'
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
  // Writing uses paid AI, so the write route waits for an explicit confirmation before starting.
  const [confirmed, setConfirmed] = useState(false)
  const hasDescription = Boolean(workspaceJob.description?.trim())
  const { job, task, loading, error, startErrors, subscriptionError, retry, refetch } = useResumeTailoring(id, { autoStart: autoStart && confirmed })
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
        <ContentSkeleton label="Loading resume…" layout="detail" />
      )}
      {job?.resume && <h2 className="text-lg font-medium break-words">{job.resume.title}</h2>}
      {job?.resume && <SavedResumeEditor key={job.resume.id} resumeId={job.resume.id} title={job.resume.title} includeSummary={job.resume.includeSummary} sections={job.resume.sections} jobId={id} onSummaryAccepted={refetch} onDeleted={() => void navigate(resumeTab)} />}
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
          {hasDescription ? (
            <WriteResumeAction
              jobId={id}
              resumeId={null}
              comparisonFinished={comparison.completed}
              comparisonBusy={comparison.busy}
              hasDescription
              hasRequirements={workspaceJob.requirements.length > 0 || workspaceJob.niceToHaves.length > 0}
              onCompare={() => void comparison.start()}
            />
          ) : (
            <MissingDescriptionNotice jobId={id} />
          )}
        </div>
      )}
      {job && !job.resume && !task && autoStart && !confirmed && !loading && startErrors.length === 0 && (
        <Card>
          <CardContent className="grid gap-4">
            <h2 className="text-lg font-medium">Write a resume for this job?</h2>
            {hasDescription ? (
              <>
                <p className="text-sm text-muted-foreground">
                  The AI will write a complete draft from your career library and this job's description. It uses AI time and usually takes under a minute. You review and edit every section before anything is saved.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => setConfirmed(true)}>Start writing</Button>
                  <Button asChild variant="outline"><Link to={resumeTab}>Cancel</Link></Button>
                </div>
              </>
            ) : (
              <MissingDescriptionNotice jobId={id} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Why writing is unavailable without a job description, with a way to add one. */
function MissingDescriptionNotice({ jobId }: { jobId: string }) {
  return (
    <div className="grid justify-items-center gap-2">
      <Button type="button" disabled aria-describedby={`resume-description-needed-${jobId}`}>Write resume</Button>
      <p id={`resume-description-needed-${jobId}`} className="text-sm text-muted-foreground">
        A resume is tailored to the job description, and this job doesn't have one yet.{' '}
        <Link to={`/jobs/${jobId}/posting`} className="underline underline-offset-4">Add one on the Posting tab</Link>.
      </p>
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
        includeSummary={typeof task.input === 'object' && task.input !== null && 'include_summary' in task.input ? task.input.include_summary !== false : true}
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
        <AiWaitingLine
          statusLabel="Writing your complete draft…"
          captions={['Preparing your resume draft']}
        />
        <p className="text-sm text-muted-foreground">This usually takes under a minute. Your sections will appear together when the draft is ready to review. You can leave this page; the draft will be waiting on this job's Resume tab.</p>
      </CardContent>
    </Card>
  )
}
