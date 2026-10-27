/** Home (/): where each saved job stands and the one thing to do next for it.
 *
 * Drawn as a transit map: the stages are stations on one line (Rejected is a branch), and each
 * job is a tile with its own five-stop line. Jobs show as that board or as a list (remembered
 * per browser). Rails suggests each job's next step, shown as a signal bullet: red needs you,
 * blue means AI is working, yellow means waiting, green means an offer. Jobs with AI work
 * running are also listed in the strip at the top. With no saved jobs yet, Home shows the
 * three steps that start a search instead.
 */
import { useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { JobStopLine } from '@/features/jobs/JobStopLine'
import { JOB_STAGE_LABELS, JOB_STAGE_ORDER, type JobStage } from '@/features/jobs/jobStageLabels'
import type { JobPipelineQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { cn } from '@/lib/utils'
import { JOB_PIPELINE_QUERY } from './homeOperations'
import { readHomeView, rememberHomeView, type HomeView } from './homeView'
import { NEXT_STEPS } from './nextSteps'
import { NextStep, SignalLegend } from './NextStepSignal'

type PipelineEntry = JobPipelineQuery['jobPipeline'][number]

export function HomePage() {
  const { data, loading, error, refetch } = useQuery(JOB_PIPELINE_QUERY, { fetchPolicy: 'cache-and-network' })
  const [view, setView] = useState<HomeView>(readHomeView)
  const entries = data?.jobPipeline ?? []
  const running = entries.filter((entry) => NEXT_STEPS[entry.nextStep]?.signal === 'ai')

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
          <Button asChild variant="outline" size="lg"><Link to="/jobs/find">Find jobs</Link></Button>
          <Button asChild size="lg"><Link to="/jobs/new">Add a job</Link></Button>
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
          <section className="signal-strip" aria-labelledby="home-running-heading">
            <h2 id="home-running-heading">AI work in progress</h2>
            {running.length > 0 ? (
              <ul>
                {running.map((entry) => (
                  <li key={entry.job.id}>
                    <span className="signal-strip-job">{entry.job.title}</span>
                    <NextStep entry={entry} />
                  </li>
                ))}
              </ul>
            ) : <p className="signal-strip-idle">Nothing running right now</p>}
            <SignalLegend />
          </section>
          <div className="home-toolbar">
            <h2>{entries.length === 1 ? '1 saved job' : `${entries.length} saved jobs`}</h2>
            <div className="view-switch" role="group" aria-label="Show jobs as">
              <button type="button" aria-pressed={view === 'board'} onClick={() => chooseView('board')}>Board</button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => chooseView('list')}>List</button>
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

/** Offer and Rejected stations look different: Offer is the green end of the line, Rejected a branch. */
function stageClass(stage: JobStage) {
  return cn(stage === 'OFFER' && 'is-offer', stage === 'REJECTED' && 'is-rejected')
}

/** Screen readers hear the count once, in the heading; the bullet repeats it for the eye. */
function StageHeading({ id, stage, count }: { id: string; stage: JobStage; count: number }) {
  return <>
    <span className="station-bullet" aria-hidden>{count}</span>
    <h2 id={id}>{JOB_STAGE_LABELS[stage]}<span className="sr-only">, {count === 1 ? '1 job' : `${count} jobs`}</span></h2>
    {stage === 'REJECTED' && <small className="station-note">Branch line</small>}
  </>
}

/** One column per stage under its station, scrolling sideways when the screen is narrow. */
function PipelineBoard({ entries }: { entries: PipelineEntry[] }) {
  return (
    <div className="pipeline-board">
      {JOB_STAGE_ORDER.map((stage) => {
        const inStage = entriesInStage(entries, stage)
        const headingId = `pipeline-${stage.toLowerCase()}`
        return (
          <section key={stage} className={cn('pipeline-column', stageClass(stage))} aria-labelledby={headingId}>
            <div className="station"><StageHeading id={headingId} stage={stage} count={inStage.length} /></div>
            {inStage.length > 0 ? (
              <ul>
                {inStage.map((entry) => (
                  <li key={entry.job.id} className={cn('job-tile', stage === 'REJECTED' && 'is-closed')}>
                    <JobName entry={entry} />
                    <JobStopLine stage={stage} />
                    <div className="next-step-row"><NextStep entry={entry} /></div>
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
      {JOB_STAGE_ORDER.map((stage) => {
        const inStage = entriesInStage(entries, stage)
        if (inStage.length === 0) return null
        const headingId = `pipeline-list-${stage.toLowerCase()}`
        return (
          <section key={stage} className={stageClass(stage)} aria-labelledby={headingId}>
            <div className="list-station"><StageHeading id={headingId} stage={stage} count={inStage.length} /></div>
            <ul>
              {inStage.map((entry) => (
                <li key={entry.job.id} className={cn('pipeline-row', stage === 'REJECTED' && 'is-closed')}>
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
      <h3><Link to={`/jobs/${job.id}`}>{job.title}</Link></h3>
      <p>{[job.company ?? 'Unknown company', job.location].filter(Boolean).join(' · ')}</p>
    </div>
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
