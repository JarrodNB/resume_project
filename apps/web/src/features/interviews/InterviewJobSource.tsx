/** Identifies the current saved job beside saved practice, with navigation only while its job exists. */
import { Link } from 'react-router'
import type { InterviewJob } from './InterviewJobContext'

export function InterviewJobSource({ job }: { job: Pick<InterviewJob, 'id' | 'title' | 'company'> }) {
  return <div className="grid min-w-0 gap-2 border-b pb-4">
    <p className="font-medium break-words">{job.title}</p>
    <p className="text-sm text-muted-foreground break-words">{job.company ?? 'Unknown company'}</p>
    {job.id ? <Link className="justify-self-start text-sm underline underline-offset-4" to={`/jobs/${job.id}`}>Back to job</Link>
      : <p className="text-sm text-muted-foreground">The original job was deleted. Your prepared questions and saved answers remain available.</p>}
  </div>
}
