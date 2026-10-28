/**
 * Description: One saved resume (/resumes/:id). A resume whose job still exists lives in that
 * job's Resume tab, so this page sends it there. A resume whose job was deleted is edited here.
 * Index:
 *   - ResumePage: page component
 */
import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { SavedResumeEditor } from '@/features/resume-tailoring/SavedResumeEditor'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { useResume } from './useResumes'

/** Opens one saved resume for editing, or its job's Resume tab when the job still exists. */
export function ResumePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { resume, loading, error } = useResume(id)

  if (resume?.job) return <Navigate to={`/jobs/${resume.job.id}/resume`} replace />

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Button asChild variant="ghost" size="sm" className="justify-self-start">
        <Link to="/resumes">
          <ArrowLeft /> Back to resumes
        </Link>
      </Button>
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{resume?.title ?? 'Resume'}</h1>
        {resume && <p className="text-muted-foreground">The job for this resume was removed.</p>}
      </div>
      {error && <ErrorAlert title="Couldn't load this resume" messages={[requestErrorMessage(error, error.message)]} />}
      {!resume && loading && <p className="text-muted-foreground">Loading…</p>}
      {resume && <SavedResumeEditor key={resume.id} resumeId={resume.id} title={resume.title} includeSummary={resume.includeSummary} sections={resume.sections} onDeleted={() => void navigate('/resumes')} />}
    </div>
  )
}
