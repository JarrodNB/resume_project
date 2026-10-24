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
import { markdownFromResult, warningsFromResult } from './parseTailorTask'
import { ResumeTargetChoice } from './ResumeTargetChoice'
import { SavedResumeEditor } from './SavedResumeEditor'
import { useResumeTailoring } from './useResumeTailoring'
import { useTailorActions } from './useTailorActions'

/** Follows tailoring for one job, or shows the resume already saved for it. */
export function TailorResumePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { job, task, loading, error, startErrors, subscriptionError, retry, refetch, targetPages, setTargetPages, twoPageEligible, starting, begin, activeTargetPages } = useResumeTailoring(id)
  const actions = useTailorActions(task?.id ?? '', () => void refetch())

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Button asChild variant="ghost" size="sm" className="justify-self-start">
        <Link to={`/jobs/${id}`}>
          <ArrowLeft /> Back to job
        </Link>
      </Button>
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{job?.resume ? job.resume.title : 'Write resume'}</h1>
        {job && (
          <Link to={`/jobs/${job.id}`} className="text-muted-foreground underline-offset-4 hover:underline">
            {job.title} at {job.company ?? 'Unknown company'}
          </Link>
        )}
      </div>
      {error && <ErrorAlert title="Couldn't load this job" messages={[requestErrorMessage(error, error.message)]} />}
      {subscriptionError && <ErrorAlert title="Couldn't follow the resume" messages={[subscriptionError.message]} />}
      <ErrorAlert messages={startErrors} title="Couldn't start the resume" />
      {job && !job.resume && !task && (
        <ResumeTargetChoice targetPages={targetPages} onChange={setTargetPages} twoPageEligible={twoPageEligible} starting={starting} onStart={() => void begin()} />
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
      {job?.resume && <SavedResumeEditor key={job.resume.id} resumeId={job.resume.id} title={job.resume.title} markdown={job.resume.markdown} jobId={id} onDeleted={() => void navigate(`/jobs/${id}`)} />}
      {job && !job.resume && task?.status === 'FAILED' && (
        <Card>
          <CardContent className="grid gap-4">
            <ErrorAlert title="The resume couldn't be written" messages={[task.errorMessage ?? 'Something went wrong. Please try again.']} />
            <Button type="button" variant="outline" className="justify-self-start" onClick={retry}>
              Try again
            </Button>
            {activeTargetPages === 2 && (
              <Button type="button" variant="outline" className="justify-self-start" disabled={starting} onClick={() => void begin(1)}>
                Try one page instead
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {task && <p className="text-sm text-muted-foreground">Target: {activeTargetPages === 2 ? 'two pages' : 'one page'}</p>}
      {job && !job.resume && task && task.status !== 'FAILED' && task.acceptedAt === null && (
        <TailorProgress task={task} actions={actions} />
      )}
    </div>
  )
}

/** A whole-draft loading message or the completed editor. */
function TailorProgress({
  task,
  actions,
}: {
  task: NonNullable<ReturnType<typeof useResumeTailoring>['task']>
  actions: ReturnType<typeof useTailorActions>
}) {
  if (task.status === 'COMPLETED' && markdownFromResult(task.result)) {
    return (
      <FinalResumeEditor
        key={task.id}
        markdown={markdownFromResult(task.result)}
        warnings={warningsFromResult(task.result)}
        pending={actions.pending}
        errors={actions.errors}
        onSave={actions.saveResume}
      />
    )
  }

  return (
    <Card className="bg-section-skills">
      <CardContent className="grid gap-2">
        <p className="flex items-center gap-2 font-medium" role="status">
          <LoaderCircle className="size-4 animate-spin text-section-skills-accent" aria-hidden /> Writing your complete draft…
        </p>
        <p className="text-sm text-muted-foreground">Your complete draft will appear when it is ready to review.</p>
      </CardContent>
    </Card>
  )
}
