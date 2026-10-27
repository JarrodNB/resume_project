/** Home (/): where each saved job stands and the one thing to do next for it.
 *
 * Jobs are grouped by application stage, as a board or a list (remembered per browser).
 * Rails suggests each job's next step; jobs with AI work running are also listed at the top.
 * With no saved jobs yet, Home shows the three steps that start a search instead.
 */
import { useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { Link } from 'react-router'
import { AlertCircle, ArrowRight, Columns3, List, LoaderCircle, Plus, Search } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { JOB_STAGE_LABELS } from '@/features/jobs/jobStageLabels'
import type { JobPipelineQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { cn } from '@/lib/utils'
import { JOB_PIPELINE_QUERY } from './homeOperations'
import { readHomeView, rememberHomeView, type HomeView } from './homeView'
import { NEXT_STEPS, nextStepPath } from './nextSteps'

type PipelineEntry = JobPipelineQuery['jobPipeline'][number]
type JobStage = PipelineEntry['job']['stage']

/** Board columns and list groups, in the order an application moves. */
const STAGE_ORDER: JobStage[] = ['UNAPPLIED', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED']

export function HomePage() {
  const { data, loading, error, refetch } = useQuery(JOB_PIPELINE_QUERY, { fetchPolicy: 'cache-and-network' })
  const [view, setView] = useState<HomeView>(readHomeView)
  const entries = data?.jobPipeline ?? []
  const running = entries.filter((entry) => NEXT_STEPS[entry.nextStep]?.tone === 'running')

  function chooseView(next: HomeView) {
    setView(next)
    rememberHomeView(next)
  }

  return (
    <div className="home-page">
      <PageHeading
        title="Your job search"
        description="Where each application stands, and what to do next for it."
        actions={<>
          <Button asChild variant="outline"><Link to="/jobs/find"><Search aria-hidden /> Find jobs</Link></Button>
          <Button asChild><Link to="/jobs/new"><Plus aria-hidden /> Add a job</Link></Button>
        </>}
      />
      {error && (
        <div className="grid gap-3">
          <ErrorAlert title="Couldn't load your jobs" messages={[requestErrorMessage(error, error.message)]} />
          <Button variant="outline" className="justify-self-start" disabled={loading} onClick={() => void refetch().catch(() => { /* The query error stays on screen. */ })}>Try again</Button>
        </div>
      )}
      {!data && loading && <p role="status" className="text-muted-foreground">Loading your jobs…</p>}
      {data && entries.length === 0 && <FirstRun />}
      {entries.length > 0 && (
        <>
          {running.length > 0 && (
            <section className="home-running" aria-labelledby="home-running-heading">
              <h2 id="home-running-heading">AI work in progress</h2>
              <ul>
                {running.map((entry) => (
                  <li key={entry.job.id}>
                    <span className="home-running-job">{entry.job.title}</span>
                    <NextStep entry={entry} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="home-toolbar">
            <p>{entries.length === 1 ? '1 saved job' : `${entries.length} saved jobs`}</p>
            <div className="home-view-toggle" role="group" aria-label="Show jobs as">
              <Button variant={view === 'board' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'board'} onClick={() => chooseView('board')}>
                <Columns3 aria-hidden /> Board
              </Button>
              <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'list'} onClick={() => chooseView('list')}>
                <List aria-hidden /> List
              </Button>
            </div>
          </div>
          {view === 'board' ? <PipelineBoard entries={entries} /> : <PipelineList entries={entries} />}
        </>
      )}
    </div>
  )
}

function entriesInStage(entries: PipelineEntry[], stage: JobStage) {
  return entries.filter((entry) => entry.job.stage === stage)
}

/** One column per stage, scrolling sideways when the screen is narrow. */
function PipelineBoard({ entries }: { entries: PipelineEntry[] }) {
  return (
    <div className="pipeline-board">
      {STAGE_ORDER.map((stage) => {
        const inStage = entriesInStage(entries, stage)
        const headingId = `pipeline-${stage.toLowerCase()}`
        return (
          <section key={stage} className="pipeline-column" aria-labelledby={headingId}>
            <h2 id={headingId}>{JOB_STAGE_LABELS[stage]} <span className="pipeline-count">{inStage.length}</span></h2>
            {inStage.length > 0 ? (
              <ul>
                {inStage.map((entry) => (
                  <li key={entry.job.id} className="pipeline-card">
                    <JobName entry={entry} />
                    <NextStep entry={entry} />
                  </li>
                ))}
              </ul>
            ) : <p className="pipeline-empty">No jobs</p>}
          </section>
        )
      })}
    </div>
  )
}

/** The same groups as rows, skipping stages with no jobs. */
function PipelineList({ entries }: { entries: PipelineEntry[] }) {
  return (
    <div className="pipeline-list">
      {STAGE_ORDER.map((stage) => {
        const inStage = entriesInStage(entries, stage)
        if (inStage.length === 0) return null
        const headingId = `pipeline-list-${stage.toLowerCase()}`
        return (
          <section key={stage} aria-labelledby={headingId}>
            <h2 id={headingId}>{JOB_STAGE_LABELS[stage]} <span className="pipeline-count">{inStage.length}</span></h2>
            <ul>
              {inStage.map((entry) => (
                <li key={entry.job.id} className="pipeline-row">
                  <JobName entry={entry} />
                  <NextStep entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function JobName({ entry }: { entry: PipelineEntry }) {
  const { job } = entry
  return (
    <div className="pipeline-job">
      <Link to={`/jobs/${job.id}`}>{job.title}</Link>
      <p>{[job.company ?? 'Unknown company', job.location].filter(Boolean).join(' · ')}</p>
    </div>
  )
}

/** The suggested step, linked to the job tab that handles it. */
function NextStep({ entry }: { entry: PipelineEntry }) {
  const step = NEXT_STEPS[entry.nextStep]
  if (!step) return null
  const icon = step.tone === 'running'
    ? <LoaderCircle className="animate-spin" aria-hidden />
    : step.tone === 'attention' ? <AlertCircle aria-hidden />
      : step.tone === 'action' ? <ArrowRight aria-hidden /> : null
  const className = cn('next-step', `is-${step.tone}`)
  if (step.tab === null) return <p className={className}>{step.label}</p>
  return (
    <Link to={nextStepPath(entry.job.id, step.tab)} className={className} aria-label={`${step.label}: ${entry.job.title}`}>
      {step.tone !== 'action' && icon}
      {step.label}
      {step.tone === 'action' && icon}
    </Link>
  )
}

/** The three steps that start a search, shown before any job is saved. */
function FirstRun() {
  return (
    <section className="home-first-run" aria-labelledby="first-run-heading">
      <h2 id="first-run-heading">Start your search in three steps</h2>
      <ol>
        <li>
          <h3>Fill your career library</h3>
          <p>Import a PDF or Word resume, or add details by hand. Everything you write later comes from here.</p>
          <Link to="/library/import">Import a resume <ArrowRight aria-hidden /></Link>
        </li>
        <li>
          <h3>Save a job you want</h3>
          <p>Search current listings, paste a job ad, or add a posting link.</p>
          <Link to="/jobs/find">Find jobs <ArrowRight aria-hidden /></Link>
        </li>
        <li>
          <h3>Compare, then write</h3>
          <p>Open a saved job to see how your library matches it, answer gaps, and write a tailored resume.</p>
        </li>
      </ol>
    </section>
  )
}
