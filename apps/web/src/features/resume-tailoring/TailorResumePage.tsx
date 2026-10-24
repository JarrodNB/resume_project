/** Follows whole-draft generation for one job, then lets the user review and save it.
 * Later visits edit the saved resume. Live task status arrives over a subscription.
 */
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { FinalResumeEditor } from './FinalResumeEditor'
import { finishedSectionsFromResult, warningsFromResult } from './parseTailorTask'
import { SavedResumeEditor } from './SavedResumeEditor'
import { useResumeTailoring } from './useResumeTailoring'
import { useTailorActions } from './useTailorActions'

/** Follows tailoring for one job, or shows the resume already saved for it. */
export function TailorResumePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { job, task, loading, error, startErrors, subscriptionError, retry, refetch } = useResumeTailoring(id)
  const actions = useTailorActions(task?.id ?? '', () => void refetch())

  return (
    <div className="resume-page mx-auto grid w-full max-w-5xl gap-6">
      <Button asChild variant="ghost" size="sm" className="justify-self-start">
        <Link to={`/jobs/${id}`}>
          <ArrowLeft /> Back to job
        </Link>
      </Button>
      <div className="resume-page-heading">
        <h1 className="break-words text-3xl font-semibold tracking-tight">{job?.resume ? job.resume.title : 'Write resume'}</h1>
        {job && (
          <Link to={`/jobs/${job.id}`} className="mt-3 inline-block max-w-full break-words text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
            {job.title} at {job.company ?? 'Unknown company'}
          </Link>
        )}
      </div>
      {error && <ErrorAlert title="Couldn't load this job" messages={[requestErrorMessage(error, error.message)]} />}
      {subscriptionError && <ErrorAlert title="Couldn't follow the resume" messages={[subscriptionError.message]} />}
      <ErrorAlert messages={startErrors} title="Couldn't start the resume" />
      {job && !job.resume && startErrors.length > 0 && !task && (
        <Button type="button" variant="outline" onClick={retry}>Try again</Button>
      )}
      {!job && loading && (
        <Card>
          <CardContent>
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          </CardContent>
        </Card>
      )}
      {job?.resume && <SavedResumeEditor key={job.resume.id} resumeId={job.resume.id} title={job.resume.title} sections={job.resume.sections} jobId={id} onDeleted={() => void navigate(`/jobs/${id}`)} />}
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
        <p className="text-sm text-muted-foreground">Your sections will appear together when the draft is ready to review.</p>
      </CardContent>
    </Card>
  )
}
