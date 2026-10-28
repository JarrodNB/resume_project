/** Lists owned sessions with their frozen job identity so past practice stays recognizable. */
import { Link } from 'react-router'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/ui/button'
import { useRecentInterviews } from './useRecentInterviews'

export function RecentInterviews() {
  const { interviews, loading, error, refresh } = useRecentInterviews()
  return <SectionCard title="Recent interviews" tone="career_contexts" sectionId="spoken:recent-interviews">
    <p className="max-w-prose text-sm text-muted-foreground">Your latest 20 saved interviews appear here until their text expires. Open an unfinished interview to continue, or review a completed one.</p>
    {loading && <p role="status">Loading saved interviews…</p>}
    {error && <div className="grid gap-3"><p role="alert">Could not load saved interviews. Try again when connected.</p><Button className="justify-self-start" variant="outline" onClick={() => void refresh()}>Try again</Button></div>}
    {!loading && !error && !interviews.length && <p className="text-sm">No recent interviews. Prepare one above to get started.</p>}
    <ol className="divide-y">
      {interviews.map((interview) => {
        const date = new Date(interview.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        return <li key={interview.id} className="flex flex-wrap items-center justify-between gap-3 py-4 last:pb-0">
          <div className="grid gap-1 text-sm">
            {interview.jobContext && <><p className="font-medium break-words">{interview.jobContext.title}</p><p className="text-muted-foreground break-words">{interview.jobContext.company ?? 'Unknown company'}</p></>}
            <p className="font-medium">{interview.status === 'abandoned' ? 'Ended' : interview.status.charAt(0).toUpperCase() + interview.status.slice(1)}</p>
            <time className="text-muted-foreground" dateTime={interview.createdAt}>{date}</time>
            {interview.questions.length > 0 && interview.status !== 'abandoned' && interview.status !== 'expired' && <p className="text-muted-foreground">{interview.status === 'completed' ? `${interview.questions.length} core questions` : `Core question ${interview.currentQuestionPosition + 1} of ${interview.questions.length}`}</p>}
          </div>
          {interview.status !== 'abandoned' && interview.status !== 'expired' && <Link className="text-sm underline underline-offset-4" to={`/practice/interviews/${interview.id}`} aria-label={`${interview.status === 'completed' ? 'Review' : 'Resume'} interview${interview.jobContext ? ` for ${interview.jobContext.title}` : ''} from ${date}`}>{interview.status === 'completed' ? 'Review interview' : 'Resume interview'}</Link>}
        </li>
      })}
    </ol>
  </SectionCard>
}
