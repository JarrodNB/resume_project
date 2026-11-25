/** Home's map of the whole search: five stations, one per stage, each showing how many jobs are there.
 *
 * It stays the same size whether you saved three jobs or three hundred, so it is the overview;
 * each station links to the Jobs list filtered to that stage. Offer ends the line in green and
 * Rejected is a dashed branch.
 */
import { Link } from 'react-router'
import { JOB_STAGE_LABELS, JOB_STAGE_ORDER } from '@/features/jobs/jobStageLabels'
import { cn } from '@/lib/utils'
import type { PipelineEntry } from './homeSummary'
import { countByStage } from './homeSummary'

export function StageLine({ entries }: { entries: PipelineEntry[] }) {
  const counts = countByStage(entries)
  return (
    <nav className="stage-line" aria-label="Jobs by stage">
      <ol>
        {JOB_STAGE_ORDER.map((stage) => (
          <li key={stage} className={cn(stage === 'OFFER' && 'is-offer', stage === 'REJECTED' && 'is-rejected')}>
            <Link to={`/jobs?stage=${stage}`}>
              <span className="station-bullet" aria-hidden>{counts[stage]}</span>
              <span className="stage-line-name">{JOB_STAGE_LABELS[stage]}</span>
              <span className="sr-only">, {counts[stage] === 1 ? '1 job' : `${counts[stage]} jobs`}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}
