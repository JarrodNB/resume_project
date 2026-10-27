/** A job's suggested next step as a signal bullet plus words, and the legend of signal colors.
 *
 * Shared by Home and the saved jobs list so a signal means the same thing everywhere: red needs
 * you, blue means AI is working, yellow means waiting, green means an offer. A step with a job tab
 * links there; a job with no step still says where it stands (offer received, or closed).
 */
import { Link } from 'react-router'
import type { JobPipelineQuery } from '@/graphql/generated/graphql'
import { cn } from '@/lib/utils'
import { NEXT_STEPS, nextStepPath, SIGNAL_LABELS, type Signal } from './nextSteps'

type PipelineEntry = JobPipelineQuery['jobPipeline'][number]

/** The suggested step as a signal bullet, linked to the job tab that handles it. Jobs with no
 * step still say where they stand: an offer is green, a rejection is simply closed. */
export function NextStep({ entry }: { entry: PipelineEntry }) {
  const step = NEXT_STEPS[entry.nextStep]
  if (!step) {
    if (entry.job.stage === 'OFFER') return <p className="next-step"><SignalDot signal="done" />Offer received</p>
    if (entry.job.stage === 'REJECTED') return <p className="next-step is-quiet">Closed</p>
    return null
  }
  const content = <><SignalDot signal={step.signal} />{step.label}</>
  const className = cn('next-step', step.signal === 'wait' && 'is-quiet')
  if (step.tab === null) return <p className={className}>{content}</p>
  return (
    <Link to={nextStepPath(entry.job.id, step.tab)} className={className} aria-label={`${step.label}: ${entry.job.title}`}>
      {content}
    </Link>
  )
}

function SignalDot({ signal }: { signal: Signal }) {
  return <span className={cn('signal-dot', `is-${signal}`)} aria-hidden />
}

/** What each signal color means, shown once beside the AI work strip. */
export function SignalLegend() {
  return (
    <ul className="signal-legend" aria-label="Signal colors">
      {(Object.keys(SIGNAL_LABELS) as Signal[]).map((signal) => (
        <li key={signal}><SignalDot signal={signal} />{SIGNAL_LABELS[signal]}</li>
      ))}
    </ul>
  )
}
