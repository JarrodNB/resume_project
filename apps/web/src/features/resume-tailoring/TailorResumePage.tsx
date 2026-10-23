/** Follows whole-draft generation for one job, then lets the user review and save it.
 * Later visits edit the saved resume. Live task status arrives over a subscription.
 */
import { useState } from 'react'
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
  const { job, task, loading, error, startErrors, startPending, subscriptionError, begin, retry, refetch } = useResumeTailoring(id)
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
      {job && !job.resume && !task && !loading && (
        <TailorSetup key={id} pending={startPending} onStart={begin} />
      )}
      {job && !job.resume && task && <p className="text-sm text-muted-foreground">Target: {task.targetPageCount} {task.targetPageCount === 1 ? 'page' : 'pages'}</p>}
      {!job && loading && (
        <Card>
          <CardContent>
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          </CardContent>
        </Card>
      )}
      {job?.resume && <SavedResumeEditor key={job.resume.id} resumeId={job.resume.id} title={job.resume.title} targetPageCount={job.resume.targetPageCount} sections={job.resume.sections} jobId={id} onDeleted={() => void navigate(`/jobs/${id}`)} />}
      {job && !job.resume && task?.status === 'FAILED' && (
        <Card>
          <CardContent className="grid gap-4">
            <ErrorAlert title="The resume couldn't be written" messages={[task.errorMessage ?? 'Something went wrong. Please try again.']} />
            <Button type="button" variant="outline" className="justify-self-start" disabled={startPending} onClick={retry}>
              {startPending ? 'Starting…' : 'Try again'}
            </Button>
          </CardContent>
        </Card>
      )}
      {job && !job.resume && task && task.status !== 'FAILED' && task.acceptedAt === null && (
        <TailorProgress jobId={id} task={task} actions={actions} />
      )}
    </div>
  )
}

/** Choose a preferred maximum before any model work is requested. */
function TailorSetup({ pending, onStart }: { pending: boolean; onStart: (target: 1 | 2) => Promise<void> }) {
  const [target, setTarget] = useState<1 | 2>(2)
  return (
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void onStart(target) }}>
      <fieldset disabled={pending} aria-describedby="tailor-length-help" className="grid gap-3">
        <legend className="mb-2 font-medium">Target length</legend>
        <div className="flex flex-wrap gap-6">
          {([1, 2] as const).map((pages) => (
            <label key={pages} className="flex min-h-11 cursor-pointer items-center gap-2">
              <input type="radio" name="target-page-count" value={pages} checked={target === pages} onChange={() => setTarget(pages)} className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
              {pages} {pages === 1 ? 'page' : 'pages'}
            </label>
          ))}
        </div>
        <p id="tailor-length-help" className="text-sm text-muted-foreground">A preferred maximum. The AI will prioritize relevant content; the finished resume may be shorter or longer.</p>
      </fieldset>
      <Button type="submit" disabled={pending} className="justify-self-start">{pending ? 'Starting…' : 'Tailor resume'}</Button>
    </form>
  )
}

/** A whole-draft loading message or the completed editor. */
function TailorProgress({
  jobId,
  task,
  actions,
}: {
  jobId: string
  task: NonNullable<ReturnType<typeof useResumeTailoring>['task']>
  actions: ReturnType<typeof useTailorActions>
}) {
  if (task.status === 'COMPLETED') {
    return (
      <FinalResumeEditor
        key={task.id}
        jobId={jobId}
        targetPageCount={task.targetPageCount}
        sections={finishedSectionsFromResult(task.result)}
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
        <p className="text-sm text-muted-foreground">Your sections will appear together when the draft is ready to review.</p>
      </CardContent>
    </Card>
  )
}
