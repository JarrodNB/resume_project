/** Home's "This week" lane: what the user got done in the last seven days.
 *
 * A seven-stop line (one stop per day, filled when something happened, today ringed) over four
 * counts: jobs saved, applications sent, interviews practiced, resumes edited. It is a quiet record,
 * not a target: an empty week says so plainly and points at one small next step. Dates come from
 * what the app already saves; see weekActivity.ts.
 */
import { useQuery } from '@apollo/client/react'
import { Link } from 'react-router'
import { RECENT_INTERVIEWS } from '@/features/interviews/interviewOperations'
import { RESUMES_QUERY } from '@/features/resumes/resumesOperations'
import { cn } from '@/lib/utils'
import type { PipelineEntry } from './homeSummary'
import { buildWeekActivity, type WeekEvents } from './weekActivity'

const TOTAL_LABELS: Record<keyof WeekEvents, string> = {
  jobsSaved: 'Jobs saved', applicationsSent: 'Applications sent', interviewsPracticed: 'Interviews practiced', resumesEdited: 'Resumes edited',
}

export function WeekPanel({ entries }: { entries: PipelineEntry[] }) {
  const resumes = useQuery(RESUMES_QUERY, { fetchPolicy: 'cache-and-network' })
  const interviews = useQuery(RECENT_INTERVIEWS, { fetchPolicy: 'cache-and-network' })
  const settled = (result: { data?: unknown; error?: unknown }) => !!result.data || !!result.error
  const week = buildWeekActivity(new Date(), {
    jobsSaved: entries.map((entry) => entry.job.createdAt),
    applicationsSent: entries.flatMap((entry) => (entry.job.appliedAt ? [entry.job.appliedAt] : [])),
    interviewsPracticed: (interviews.data?.recentInterviewSessions ?? []).filter((session) => session.status !== 'abandoned').map((session) => session.createdAt),
    resumesEdited: (resumes.data?.resumes ?? []).map((resume) => resume.updatedAt),
  })

  return (
    <section className="home-lane" aria-labelledby="week-heading">
      <div className="lane-head"><h2 id="week-heading">This week</h2><span>Last 7 days</span></div>
      {settled(resumes) && settled(interviews) ? (
        <>
          <ol className="week-line">
            {week.days.map((day) => (
              <li key={day.key} className={cn(day.count > 0 && 'has-activity', day.isToday && 'is-today')}>
                <span className="week-stop" aria-hidden />
                <span className="week-day">{day.isToday ? 'Today' : day.label}</span>
                <span className="sr-only">, {day.count === 0 ? 'nothing' : day.count === 1 ? '1 thing' : `${day.count} things`}</span>
              </li>
            ))}
          </ol>
          <dl className="week-totals">
            {(Object.keys(TOTAL_LABELS) as (keyof WeekEvents)[]).map((kind) => (
              <div key={kind}><dd>{week.totals[kind]}</dd><dt>{TOTAL_LABELS[kind]}</dt></div>
            ))}
          </dl>
          {week.total === 0 && <p className="lane-quiet">A quiet week so far. <Link to="/jobs/find">Find a job</Link> or <Link to="/practice/questions">answer one practice question</Link> to get moving.</p>}
        </>
      ) : <p className="lane-quiet" role="status">Loading your week…</p>}
    </section>
  )
}
