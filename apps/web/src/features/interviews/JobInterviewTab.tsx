/** The job workspace's Interview tab: set up a spoken practice interview for this saved job.
 * The workspace has already loaded the owned job, so setup starts from it directly.
 */
import { useLocation } from 'react-router'
import { useJobWorkspace } from '@/features/jobs/useJobWorkspace'
import { InterviewSetup } from './InterviewSetup'
import { InterviewPrivacy, ProviderNotice } from './InterviewPage'
import './interviewRoom.css'

export function JobInterviewTab() {
  const { job } = useJobWorkspace()
  const { state } = useLocation()
  return <div className="interview-page grid w-full gap-6">
    {state?.interviewEnded === 'abandoned' && <p role="status" className="text-sm">Interview ended. You can prepare another whenever you’re ready.</p>}
    <InterviewSetup key={job.id} job={job} initialSetup={state?.practiceSetup} notice={<ProviderNotice />} />
    <InterviewPrivacy />
  </div>
}
