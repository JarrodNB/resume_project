/**
 * Description: Saved resumes list (/resumes), most recently updated first.
 * Index:
 *   - ResumesPage: page component
 */
import { ArrowUpRight, FileText } from 'lucide-react'
import { Link } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { PageHeading } from '@/components/PageHeading'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { useResumes } from './useResumes'

/** Lists the user's tailored resumes, each linking to its own page. */
export function ResumesPage() {
  const { resumes, loading, error } = useResumes()

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeading title="Resumes" description="Your experience, shaped for each opportunity. Open a draft to review, refine, and export." />
      {error && <ErrorAlert title="Couldn't load your resumes" messages={[requestErrorMessage(error, error.message)]} />}
      {!resumes && loading && <p className="text-muted-foreground">Loading…</p>}
      {resumes?.length === 0 && (
        <div className="empty-records">
            <FileText size={30} strokeWidth={1.4} aria-hidden />
            <h2>Your next resume starts with a job</h2>
            <p>No resumes yet. Write one from a job after you've compared it with your library.</p>
            <Button asChild>
              <Link to="/jobs">Go to jobs</Link>
            </Button>
        </div>
      )}
      {resumes && resumes.length > 0 && (
        <ul className="record-list">
          {resumes.map((resume) => (
            <li key={resume.id}>
              <Link to={`/resumes/${resume.id}`} className="record-link focus-visible:outline-2 focus-visible:outline-ring">
                <FileText size={20} className="record-icon" aria-hidden />
                <div className="record-text">
                  <p className="font-medium">{resume.title}</p>
                  <p className="text-sm text-muted-foreground">{resume.job ? `${resume.job.title} at ${resume.job.company ?? 'Unknown company'}` : 'The job for this resume was removed.'}</p>
                </div>
                <ArrowUpRight size={17} className="record-arrow" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
