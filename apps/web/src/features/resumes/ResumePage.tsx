/**
 * Description: One saved resume (/resumes/:id). The breadcrumb returns to the job when this
 * page was opened from that job, and to the resume list otherwise. The job name always links
 * to the job while it still exists.
 * Index:
 *   - ResumePage: page component
 */
import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { SavedResumeEditor } from '@/features/resume-tailoring/SavedResumeEditor'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { useResume } from './useResumes'

/** Opens one saved resume for editing. The breadcrumb follows where the user came from. */
export function ResumePage() {
  const { id = '' } = useParams()
  const fromJob = cameFromJob(useLocation().state)
  const { resume, loading, error } = useResume(id)
  const backToJob = Boolean(resume?.job && fromJob === resume.job.id)

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Button asChild variant="ghost" size="sm" className="justify-self-start">
        <Link to={backToJob && resume?.job ? `/jobs/${resume.job.id}` : '/resumes'}>
          <ArrowLeft /> {backToJob ? 'Back to job' : 'Back to resumes'}
        </Link>
      </Button>
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{resume?.title ?? 'Resume'}</h1>
        {resume?.job ? (
          <Link to={`/jobs/${resume.job.id}`} className="text-muted-foreground underline-offset-4 hover:underline">
            {resume.job.title} at {resume.job.company}
          </Link>
        ) : (
          resume && <p className="text-muted-foreground">The job for this resume was removed.</p>
        )}
      </div>
      {error && <ErrorAlert title="Couldn't load this resume" messages={[requestErrorMessage(error, error.message)]} />}
      {!resume && loading && <p className="text-muted-foreground">Loading…</p>}
      {resume && <SavedResumeEditor resumeId={resume.id} sections={resume.sections} />}
    </div>
  )
}

/** The job id when this page was opened from that job, otherwise nothing. */
function cameFromJob(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('fromJobId' in state)) return null
  const fromJobId = state.fromJobId
  return typeof fromJobId === 'string' ? fromJobId : null
}
