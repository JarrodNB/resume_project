/**
 * Description: /jobs/:id/tailor. Writes a resume one section at a time. A finished gap analysis
 * is included when one exists.
 * Approved sections stay read-only; the current one is editable. Save stores the resume, and
 * a later visit opens that resume for editing. Preview shows the draft as a large PDF.
 * Index:
 *   - TailorResumePage: page component
 */
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { FinalResumeEditor } from './FinalResumeEditor'
import { OpenSectionCard } from './OpenSectionCard'
import { approvedSectionsFromInput, finishedSectionsFromResult, openSectionFromTask, warningsFromResult } from './parseTailorTask'
import { SavedResumeEditor } from './SavedResumeEditor'
import { SectionPreview } from './SectionPreview'
import { SECTION_TITLES, sectionBeingWritten } from './sectionOrder'
import { useResumeTailoring } from './useResumeTailoring'
import { useTailorActions } from './useTailorActions'

/** Follows tailoring for one job, or shows the resume already saved for it. */
export function TailorResumePage() {
  const { id = '' } = useParams()
  const { job, task, loading, error, startErrors, subscriptionError, retry, refetch } = useResumeTailoring(id)
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
            {job.title} at {job.company}
          </Link>
        )}
      </div>
      {error && <ErrorAlert title="Couldn't load this job" messages={[requestErrorMessage(error, error.message)]} />}
      {subscriptionError && <ErrorAlert title="Couldn't follow the resume" messages={[subscriptionError.message]} />}
      <ErrorAlert messages={startErrors} title="Couldn't start the resume" />
      {!job && loading && <p className="text-muted-foreground">Loading…</p>}
      {job?.resume && <SavedResumeEditor resumeId={job.resume.id} sections={job.resume.sections} />}
      {job && !job.resume && task?.status === 'FAILED' && (
        <>
          <ErrorAlert title="The resume couldn't be written" messages={[task.errorMessage ?? 'Something went wrong. Please try again.']} />
          <Button type="button" variant="outline" onClick={retry}>
            Try again
          </Button>
        </>
      )}
      {job && !job.resume && task && task.status !== 'FAILED' && task.acceptedAt === null && (
        <TailorProgress jobId={id} task={task} actions={actions} />
      )}
      {job && !job.resume && !task && job.latestTailoring?.status === 'FAILED' && (
        <>
          <ErrorAlert title="The resume couldn't be written" messages={[job.latestTailoring.errorMessage ?? 'Something went wrong. Please try again.']} />
          <Button type="button" variant="outline" onClick={retry}>
            Try again
          </Button>
        </>
      )}
    </div>
  )
}

/** The in-progress draft: writing, the open section, or the final editor. */
function TailorProgress({
  jobId,
  task,
  actions,
}: {
  jobId: string
  task: NonNullable<ReturnType<typeof useResumeTailoring>['task']>
  actions: ReturnType<typeof useTailorActions>
}) {
  const approved = approvedSectionsFromInput(task.input).filter((section) => !section.omitted)
  const open = openSectionFromTask(task.pendingQuestions)

  if (task.status === 'COMPLETED') {
    return (
      <FinalResumeEditor
        jobId={jobId}
        sections={finishedSectionsFromResult(task.result)}
        warnings={warningsFromResult(task.result)}
        pending={actions.pending}
        errors={actions.errors}
        onSave={(sections) => void actions.saveResume(sections)}
      />
    )
  }

  return (
    <div className="grid gap-4">
      {approved.map((section) => (
        <SectionPreview
          key={section.sectionType}
          sectionId={`resume.${jobId}.${section.sectionType}`}
          section={section}
          reopening={actions.pending}
          onReopen={(sectionType) => void actions.submitSection(sectionType, 'reopen', {})}
        />
      ))}
      {task.status === 'QUEUED' && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Writing {SECTION_TITLES[sectionBeingWritten(task.input)]}…
        </p>
      )}
      {task.status === 'NEEDS_USER_INPUT' && open && (
        <OpenSectionCard
          key={`${open.sectionType}-${open.blocked}-${open.nothingFits}`}
          open={open}
          pending={actions.pending}
          errors={actions.errors}
          onAction={(sectionType, action, content) => void actions.submitSection(sectionType, action, content)}
        />
      )}
    </div>
  )
}
