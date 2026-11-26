/** Home's Practice lane: the next useful thing to do for interviews.
 *
 * It lists, in order: an unfinished spoken interview to resume, the written question bank with its
 * next step, jobs that are ready for interview practice, and the last finished interview to review.
 * It only reads what the Practice pages already save; starting or answering happens on those pages.
 * If it cannot load, the lane says so quietly and the rest of Home keeps working.
 */
import { useQuery } from '@apollo/client/react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { INTERVIEW_QUESTION_BANK_QUERY } from '@/features/interview-prep/interviewPrepOperations'
import { RECENT_INTERVIEWS } from '@/features/interviews/interviewOperations'
import { SignalDot } from './NextStepSignal'
import type { PipelineEntry } from './homeSummary'
import type { Signal } from './nextSteps'
import { jobsReadyForInterview, lastCompletedInterview, questionBankStep, unfinishedInterview } from './practiceSummary'

/** How many ready jobs the lane lists before saying how many more there are. */
export const PRACTICE_JOB_LIMIT = 3

export function PracticePanel({ entries }: { entries: PipelineEntry[] }) {
  const bank = useQuery(INTERVIEW_QUESTION_BANK_QUERY, { fetchPolicy: 'cache-and-network' })
  const recent = useQuery(RECENT_INTERVIEWS, { fetchPolicy: 'cache-and-network' })
  const interviews = recent.data?.recentInterviewSessions ?? []
  const unfinished = unfinishedInterview(interviews)
  const lastDone = lastCompletedInterview(interviews)
  const ready = jobsReadyForInterview(entries)
  const step = bank.data ? questionBankStep(bank.data.interviewQuestions) : null
  const failed = (bank.error && !bank.data) || (recent.error && !recent.data)

  return (
    <section className="home-lane" aria-labelledby="practice-heading">
      <div className="lane-head"><h2 id="practice-heading">Practice</h2><span>Interview prep</span></div>
      {failed && <p className="lane-quiet">Couldn’t load your practice. <Link to="/practice/questions">Open Practice</Link> to try there.</p>}
      <ul>
        {unfinished && (
          <PracticeRow
            title={unfinished.jobContext ? `Interview for ${unfinished.jobContext.title}` : 'Practice interview'}
            detail={unfinished.questions.length > 0 ? `Question ${unfinished.currentQuestionPosition + 1} of ${unfinished.questions.length}` : 'In progress'}
            signal="action" label="Resume interview" to={`/practice/interviews/${unfinished.id}`}
          />
        )}
        {step && <PracticeRow title="Written questions" detail={step.detail} signal={step.signal} label={step.label} to="/practice/questions" />}
        {ready.slice(0, PRACTICE_JOB_LIMIT).map((entry) => (
          <PracticeRow
            key={entry.job.id} title={entry.job.title} detail={entry.job.company ?? 'Unknown company'}
            signal="action" label="Practice interview" to={`/jobs/${entry.job.id}/interview`} ariaLabel={`Practice interview: ${entry.job.title}`}
          />
        ))}
        {!unfinished && lastDone && (
          <PracticeRow
            title={lastDone.jobContext ? `Interview for ${lastDone.jobContext.title}` : 'Last interview'}
            detail="Completed" signal="wait" quiet label="Review interview" to={`/practice/interviews/${lastDone.id}`}
          />
        )}
      </ul>
      {ready.length > PRACTICE_JOB_LIMIT && <p className="lane-quiet">{ready.length - PRACTICE_JOB_LIMIT} more jobs are ready for interview practice.</p>}
      <Link to="/practice/interviews" className="lane-all">Start a spoken interview <ArrowRight aria-hidden /></Link>
    </section>
  )
}

interface PracticeRowProps { title: string; detail: string; signal: Signal; label: string; to: string; quiet?: boolean; ariaLabel?: string }

/** One practice item: what it is on the left, the step to take (with its signal bullet) on the right. */
function PracticeRow({ title, detail, signal, label, to, quiet, ariaLabel }: PracticeRowProps) {
  return (
    <li className="pipeline-row">
      <div className="pipeline-job"><h3>{title}</h3><p>{detail}</p></div>
      <Link to={to} className={quiet || signal === 'done' ? 'next-step is-quiet' : 'next-step'} aria-label={ariaLabel ?? `${label}: ${title}`}>
        <SignalDot signal={signal} />{label}
      </Link>
    </li>
  )
}
