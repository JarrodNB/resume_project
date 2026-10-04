/**
 * Description: Saved jobs list (/jobs), newest first, with a button to add one from a posting link.
 * Index:
 *   - JobsPage: page component
 */
import { Link2 } from 'lucide-react'
import { Link } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_STAGE_LABELS } from './jobStageLabels'
import { useJobs } from './useJobs'

/** Lists the user's jobs, each linking to its detail page. */
export function JobsPage() {
  const { jobs, loading, error } = useJobs()

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground">The roles you're tailoring resumes for.</p>
        </div>
        <Button asChild>
          <Link to="/jobs/new">
            <Link2 /> Add job from link
          </Link>
        </Button>
      </div>
      {error && <ErrorAlert title="Couldn't load your jobs" messages={[requestErrorMessage(error, error.message)]} />}
      {!jobs && loading && <p className="text-muted-foreground">Loading…</p>}
      {jobs?.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No jobs yet. Paste a job posting link to add your first one.
          </CardContent>
        </Card>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="grid gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link to={`/jobs/${job.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <Card className="transition-colors hover:bg-accent/40">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="grid gap-0.5">
                      <p className="font-medium">{job.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {[job.company, job.location].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Badge variant="secondary">{JOB_STAGE_LABELS[job.stage]}</Badge>
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
