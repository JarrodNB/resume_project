/**
 * Description: Saved resumes list (/resumes), most recently updated first.
 * Index:
 *   - ResumesPage: page component
 */
import { Link } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { useResumes } from './useResumes'

/** Lists the user's tailored resumes, each linking to its own page. */
export function ResumesPage() {
  const { resumes, loading, error } = useResumes()

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Resumes</h1>
        <p className="text-muted-foreground">Resumes you've written for a job. Newest changes first.</p>
      </div>
      {error && <ErrorAlert title="Couldn't load your resumes" messages={[requestErrorMessage(error, error.message)]} />}
      {!resumes && loading && <p className="text-muted-foreground">Loading…</p>}
      {resumes?.length === 0 && (
        <Card>
          <CardContent className="grid justify-items-center gap-4 py-10 text-center text-muted-foreground">
            <p>No resumes yet. Write one from a job after you've compared it with your library.</p>
            <Button asChild>
              <Link to="/jobs">Go to jobs</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {resumes && resumes.length > 0 && (
        <ul className="grid gap-3">
          {resumes.map((resume) => (
            <li key={resume.id}>
              <Link to={`/resumes/${resume.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <Card className="transition-colors hover:bg-accent/40">
                  <CardContent className="grid gap-0.5">
                    <p className="font-medium">{resume.title}</p>
                    <p className="text-sm text-muted-foreground">{resume.job ? `${resume.job.title} at ${resume.job.company}` : 'The job for this resume was removed.'}</p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
