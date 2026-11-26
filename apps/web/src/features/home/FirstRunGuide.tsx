/** The four steps that start a job search, shown on Home until the user writes their first tailored resume.
 *
 * Steps are ticked off as they get done: the library step once the library has content, the job step
 * once a job is saved. The first unfinished step is the one to do now, and only that step gets a
 * filled button, so there is one obvious next move. Once a job is saved, step 3 links straight to it
 * (to the tab its suggested next step opens). Home decides when to stop showing this guide.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PipelineEntry } from './homeSummary'
import { NEXT_STEPS, nextStepPath } from './nextSteps'

type StepState = 'done' | 'now' | 'next'

/** Next steps that mean the saved job has not been compared yet. */
const COMPARE_STEPS = new Set<PipelineEntry['nextStep']>(['COMPARE', 'COMPARISON_RUNNING', 'COMPARISON_FAILED'])

interface FirstRunGuideProps {
  /** Whether the career library has content; null while it is still loading. */
  libraryStarted: boolean | null
  /** The newest saved job, or null before any job is saved. */
  job: PipelineEntry | null
}

export function FirstRunGuide({ libraryStarted, job }: FirstRunGuideProps) {
  const libraryDone = !!libraryStarted
  const jobDone = job !== null
  const current = !libraryDone ? 1 : !jobDone ? 2 : 3
  const stateOf = (step: number): StepState => {
    if ((step === 1 && libraryDone) || (step === 2 && jobDone)) return 'done'
    return step === current ? 'now' : 'next'
  }

  return (
    <section className="home-first-run" aria-labelledby="first-run-heading">
      <h2 id="first-run-heading">Start your search in four steps</h2>
      <p className="first-run-time">Do these in order. The first comparison of a job against your library is where it starts to pay off.</p>
      <ol>
        <Step state={stateOf(1)} title="Fill your career library">
          {libraryDone ? (
            <>
              <p>Your library has content. Everything you write later comes from here.</p>
              <StepLink to="/library" primary={false}>Review your library</StepLink>
            </>
          ) : (
            <>
              <p>Import a PDF or Word resume, or add details by hand. Everything you write later comes from here.</p>
              <StepLink to="/library" primary={current === 1}>Import a resume</StepLink>
            </>
          )}
        </Step>
        <Step state={stateOf(2)} title="Save a job you want">
          {job ? (
            <p>You saved <strong>{jobName(job)}</strong>.</p>
          ) : (
            <>
              <p>Search current listings, paste a job ad, or add a posting link.</p>
              <div className="first-run-links">
                <StepLink to="/jobs/find" primary={current === 2}>Find jobs</StepLink>
                <StepLink to="/jobs/paste" primary={false}>Paste a job ad</StepLink>
                <StepLink to="/jobs/new" primary={false}>Add a posting link</StepLink>
              </div>
            </>
          )}
        </Step>
        <Step state={stateOf(3)} title="Compare, then write">
          {job ? (
            <>
              <p>{COMPARE_STEPS.has(job.nextStep)
                ? `Compare ${jobName(job)} with your library to see how you match, answer gaps, and write a tailored resume.`
                : `You compared ${jobName(job)}. Answer any gaps, then write a tailored resume.`}</p>
              <JobStepLink job={job} primary={current === 3} />
            </>
          ) : (
            <p>Open a saved job to see how your library matches it, answer gaps, and write a tailored resume.</p>
          )}
        </Step>
        <Step state="next" title="Prepare for the interview">
          <p>Practice answering interview questions using your experience and the job you saved.</p>
        </Step>
      </ol>
    </section>
  )
}

function Step({ state, title, children }: { state: StepState; title: string; children: ReactNode }) {
  return (
    <li data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
      <h3>{title}{state === 'done' && <span className="sr-only"> (done)</span>}</h3>
      {children}
    </li>
  )
}

/** The current step's action is a filled button; every other step keeps a quiet text link. */
function StepLink({ to, primary, children }: { to: string; primary: boolean; children: ReactNode }) {
  if (primary) return <Button asChild size="lg" className="first-run-action"><Link to={to}>{children} <ArrowRight aria-hidden /></Link></Button>
  return <Link to={to}>{children} <ArrowRight aria-hidden /></Link>
}

/** Links the saved job to the tab its suggested next step opens (Fit to compare, Resume to write). */
function JobStepLink({ job, primary }: { job: PipelineEntry; primary: boolean }) {
  const view = NEXT_STEPS[job.nextStep]
  const to = view?.tab != null ? nextStepPath(job.job.id, view.tab) : `/jobs/${job.job.id}`
  return <StepLink to={to} primary={primary}>{view?.tab != null ? view.label : 'Open the job'}</StepLink>
}

function jobName({ job }: PipelineEntry) {
  return job.company ? `${job.title} at ${job.company}` : job.title
}
