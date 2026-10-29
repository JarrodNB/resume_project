/**
 * Description: Saved jobs list (/jobs), newest first, with ways to add one from a link, a pasted
 * ad, or by hand. Each row shows the job's line through the stages and, once Home's pipeline has
 * loaded, its next step as the same signal bullet Home uses.
 * Index:
 *   - JobsPage: page component
 */
import { useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { ArrowUpRight, BriefcaseBusiness, ClipboardPaste, ExternalLink, Link2 } from 'lucide-react'
import { JOB_PIPELINE_QUERY } from '@/features/home/homeOperations'
import { NextStep } from '@/features/home/NextStepSignal'
import { Link, useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { PageHeading } from '@/components/PageHeading'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JobFormDialog } from './JobFormDialog'
import { JobStopLine } from './JobStopLine'
import { useJobs } from './useJobs'

/** Lists the user's jobs, each linking to its detail page. */
export function JobsPage() {
  const navigate = useNavigate()
  const { jobs, loading, error } = useJobs()
  const [adding, setAdding] = useState(false)
  // The pipeline only adds next steps; the list still works if it fails or is slow.
  const { data: pipeline } = useQuery(JOB_PIPELINE_QUERY, { fetchPolicy: 'cache-and-network' })
  const pipelineByJob = new Map(pipeline?.jobPipeline.map((entry) => [entry.job.id, entry]))

  return (
    <div className="grid max-w-5xl gap-6">
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
            <li key={job.id} className="job-record">
              <Link to={`/jobs/${job.id}`} className="record-link focus-visible:outline-2 focus-visible:outline-ring">
                <div className="record-text">
                  <p className="font-medium">{job.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {[job.company ?? 'Unknown company', job.location].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <JobStopLine stage={job.stage} showLabel className="is-compact" />
                <ArrowUpRight size={17} className="record-arrow" aria-hidden />
              </Link>
              {job.url && (
                <a href={job.url} target="_blank" rel="noreferrer" className="job-record-url" aria-label={`Open ${job.title} application page`}>
                  <ExternalLink size={14} aria-hidden /> Application page
                </a>
              )}
              {pipelineByJob.get(job.id) && <div className="job-record-step"><NextStep entry={pipelineByJob.get(job.id)!} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
