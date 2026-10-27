/** Loads the owned job from the route before showing the shared spoken-interview setup. */
import { Link, useLocation, useParams } from 'react-router'
import { PageHeading } from '@/components/PageHeading'
import { useJob } from '@/features/jobs/useJobs'
import { InterviewSetup } from './InterviewSetup'
import { InterviewPrivacy, ProviderNotice } from './InterviewPage'
import './interviewRoom.css'

export function JobInterviewSetupPage() {
  const { jobId = '' } = useParams()
  const { state } = useLocation()
  const { job, loading, error } = useJob(jobId)
  return <div className="interview-page mx-auto grid w-full max-w-6xl gap-6">
    <Link className="justify-self-start text-sm underline underline-offset-4" to={job ? `/jobs/${job.id}` : '/jobs'}>{job ? 'Back to job' : 'All jobs'}</Link>
    <PageHeading title="Practise for this job" description="Prepare a spoken interview using this saved job and your career library." />
    {loading && !job ? <p role="status">Loading saved job…</p> : error || !job ? <p role="alert">This saved job is unavailable. It may have been deleted or belong to another account. Return to your jobs to choose one.</p> : <InterviewSetup key={job.id} job={job} initialSetup={state?.practiceSetup} notice={<ProviderNotice />} />}
    <InterviewPrivacy />
  </div>
}
