/** Loads the owned job before setup, with explicit reload and alternate-job paths for unavailable sources. */
import { Link, useLocation, useParams } from 'react-router'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { useJob } from '@/features/jobs/useJobs'
import { InterviewSetup } from './InterviewSetup'
import { InterviewPrivacy, ProviderNotice } from './InterviewPage'
import './interviewRoom.css'

export function JobInterviewSetupPage() {
  const { jobId = '' } = useParams()
  const { state } = useLocation()
  const { job, loading, error, refresh } = useJob(jobId)
  return <div className="interview-page mx-auto grid w-full max-w-6xl gap-6">
    <Link className="justify-self-start text-sm underline underline-offset-4" to={job ? `/jobs/${job.id}` : '/jobs'}>{job ? 'Back to job' : 'All jobs'}</Link>
    {job && <Link className="justify-self-start text-sm underline underline-offset-4" to="/jobs">Choose another job</Link>}
    <PageHeading title="Practise for this job" description="Prepare a spoken interview using this saved job and your career library." />
    {loading && !job ? <p role="status">Loading saved job…</p> : error || !job ? <div className="grid gap-3">
      <p role="alert">This saved job is unavailable. It may have been deleted or belong to another account. Return to your jobs to choose one, or try loading it again.</p>
      <Button type="button" variant="outline" className="justify-self-start" disabled={loading} onClick={() => void refresh().catch(() => { /* The query state displays the read failure. */ })}>Try loading job again</Button>
    </div> : <InterviewSetup key={job.id} job={job} initialSetup={state?.practiceSetup} notice={<ProviderNotice />} />}
    <InterviewPrivacy />
  </div>
}
