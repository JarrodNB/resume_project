/**
 * Description: Saved jobs list (/jobs), newest first, with ways to add one from a link or by hand.
 * Index:
 *   - JobsPage: page component
 */
import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JobFormDialog } from './JobFormDialog'
import { JOB_STAGE_LABELS } from './jobStageLabels'
import { useJobs } from './useJobs'

/** Lists the user's jobs, each linking to its detail page. */
export function JobsPage() {
  const navigate = useNavigate()
  const { jobs, loading, error } = useJobs()
  const [adding, setAdding] = useState(false)

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground">The roles you're tailoring resumes for.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAdding(true)}>
            Add manually
          </Button>
          <Button asChild>
            <Link to="/jobs/new">
              <Link2 /> Add job from link
            </Link>
          </Button>
        </div>
      </div>
      <JobFormDialog open={adding} job={null} onOpenChange={setAdding} onCreated={(jobId) => navigate(`/jobs/${jobId}`)} />
      {error && <ErrorAlert title="Couldn't load your jobs" messages={[requestErrorMessage(error, error.message)]} />}
      {!jobs && loading && <p className="text-muted-foreground">Loading…</p>}
      {jobs?.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No jobs yet. Paste a job posting link, or add one yourself.
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
