/**
 * Description: Saved jobs list (/jobs), newest first, with ways to add one from a link, a pasted
 * ad, or by hand.
 * Index:
 *   - JobsPage: page component
 */
import { useState } from 'react'
import { ArrowUpRight, BriefcaseBusiness, ClipboardPaste, Link2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeading } from '@/components/PageHeading'
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
      <PageHeading title="Jobs" description="Keep the opportunities that matter in view. Prepare each application with intention." actions={
        <>
          <Button asChild><Link to="/jobs/new"><Link2 /> Add job from link</Link></Button>
          <Button asChild variant="outline"><Link to="/jobs/paste"><ClipboardPaste /> Paste a job ad</Link></Button>
          <Button variant="ghost" onClick={() => setAdding(true)}>Add manually</Button>
        </>
      } />
      <JobFormDialog open={adding} job={null} onOpenChange={setAdding} onCreated={(jobId) => navigate(`/jobs/${jobId}`)} />
      {error && <ErrorAlert title="Couldn't load your jobs" messages={[requestErrorMessage(error, error.message)]} />}
      {!jobs && loading && <p className="text-muted-foreground">Loading…</p>}
      {jobs?.length === 0 && (
        <div className="empty-records">
          <BriefcaseBusiness size={30} strokeWidth={1.4} aria-hidden />
          <h2>A place for your next opportunity</h2>
          <p>No jobs yet. Paste a job ad or a posting link, or add one yourself.</p>
          <Button asChild variant="outline"><Link to="/jobs/new">Add your first job <ArrowUpRight /></Link></Button>
        </div>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="record-list">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link to={`/jobs/${job.id}`} className="record-link focus-visible:outline-2 focus-visible:outline-ring">
                <BriefcaseBusiness size={20} className="record-icon" aria-hidden />
                <div className="record-text">
                  <p className="font-medium">{job.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {[job.company ?? 'Unknown company', job.location].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge variant="secondary">{JOB_STAGE_LABELS[job.stage]}</Badge>
                <ArrowUpRight size={17} className="record-arrow" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
