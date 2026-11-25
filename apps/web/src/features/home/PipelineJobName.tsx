/** A job's title (linked to its workspace) with company and location, shared by Home and the Jobs board. */
import { Link } from 'react-router'
import type { PipelineEntry } from './homeSummary'

export function PipelineJobName({ entry }: { entry: PipelineEntry }) {
  const { job } = entry
  return (
    <div className="pipeline-job">
      <h3><Link to={`/jobs/${job.id}`}>{job.title}</Link></h3>
      <p>{[job.company ?? 'Unknown company', job.location].filter(Boolean).join(' · ')}</p>
    </div>
  )
}
