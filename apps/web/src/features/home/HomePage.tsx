/** Home (/): where each saved job stands and the one thing to do next for it.
 *
 * Drawn as a transit map: the stages are stations on one line (Rejected is a branch), and each
 * job is a tile with its own five-stop line. Jobs show as that board or as a list (remembered
 * per browser). Rails suggests each job's next step, shown as a signal bullet: red needs you,
 * blue means AI is working, yellow means waiting, green means an offer. All AI work still
 * running is listed in the strip at the top (see AiWorkStrip), which keeps itself current and
 * reloads the board when work finishes. With no saved jobs yet, Home shows the three steps
 * that start a search instead, marking the career library step done once the library has content.
 * With jobs but an empty library, a red note says comparisons have nothing to compare yet. On the board, dragging a tile to another column moves the job to
 * that stage (saved right away, like the stage picker on the job page).
 */
import { useCallback, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { DragDropProvider } from '@dnd-kit/react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { JobStopLine } from '@/features/jobs/JobStopLine'
import { MOVE_JOB_TO_STAGE_MUTATION } from '@/features/jobs/jobsOperations'
import { useSaveJob } from '@/features/jobs/useSaveJob'
import { JOB_STAGE_LABELS, JOB_STAGE_ORDER, type JobStage } from '@/features/jobs/jobStageLabels'
import type { JobPipelineQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { cn } from '@/lib/utils'
import { CAREER_LIBRARY_QUERY } from '@/features/career-library/careerLibraryOperations'
import { libraryHasContent } from '@/features/career-library/libraryHasContent'
import { JOB_PIPELINE_QUERY } from './homeOperations'
import { readHomeView, rememberHomeView, type HomeView } from './homeView'
import { AiWorkStrip } from './AiWorkStrip'
import { NextStep, SignalDot } from './NextStepSignal'
import { DraggableJobTile, StageDropColumn, stageFromDropId } from './PipelineDragParts'

type PipelineEntry = JobPipelineQuery['jobPipeline'][number]

export function HomePage() {
  const { data, loading, error, refetch } = useQuery(JOB_PIPELINE_QUERY, { fetchPolicy: 'cache-and-network' })
  const [view, setView] = useState<HomeView>(readHomeView)
  // The library only shapes the first-run guidance; Home still works if it fails or is slow.
  const { data: libraryData } = useQuery(CAREER_LIBRARY_QUERY, { fetchPolicy: 'cache-and-network' })
  const libraryStarted = libraryData ? libraryHasContent(libraryData) : null
  const entries = data?.jobPipeline ?? []
  const reloadBoard = useCallback(() => { void refetch().catch(() => { /* The query error stays on screen. */ }) }, [refetch])

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
      {data && entries.length === 0 && <FirstRun libraryStarted={libraryStarted} />}
      {entries.length > 0 && (
        <>
          {libraryStarted === false && <EmptyLibraryNote />}
          <AiWorkStrip onWorkFinished={reloadBoard} />
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

/** One column per stage under its station, scrolling sideways when the screen is narrow.
 * A dropped tile shows in its new column while the stage saves, and snaps back if the save fails. */
function PipelineBoard({ entries }: { entries: PipelineEntry[] }) {
  const { save, busy, errors, clearErrors } = useSaveJob()
  const [movingTo, setMovingTo] = useState<Record<string, JobStage>>({})
  const shown = entries.map((entry) => (movingTo[entry.job.id] ? { ...entry, job: { ...entry.job, stage: movingTo[entry.job.id] } } : entry))

  async function moveJob(jobId: string, stage: JobStage) {
    setMovingTo((current) => ({ ...current, [jobId]: stage }))
    await save(MOVE_JOB_TO_STAGE_MUTATION, { id: jobId, stage }, [JOB_PIPELINE_QUERY])
    setMovingTo(({ [jobId]: _settled, ...rest }) => rest)
  }

  return (
    <DragDropProvider
      onDragStart={clearErrors}
      onDragEnd={(event) => {
        const stage = stageFromDropId(event.operation.target?.id)
        const jobId = String(event.operation.source?.id ?? '')
        const current = shown.find((entry) => entry.job.id === jobId)?.job.stage
        if (!event.canceled && stage && current && stage !== current && !busy) void moveJob(jobId, stage)
      }}
    >
      <ErrorAlert title="Couldn't move that job" messages={errors} />
      <div className="pipeline-board">
        {JOB_STAGE_ORDER.map((stage) => {
          const inStage = entriesInStage(shown, stage)
          const headingId = `pipeline-${stage.toLowerCase()}`
          return (
            <StageDropColumn key={stage} stage={stage} className={cn('pipeline-column', stageClass(stage))} aria-labelledby={headingId}>
              <div className="station"><StageHeading id={headingId} stage={stage} count={inStage.length} /></div>
              {inStage.length > 0 ? (
                <ul>
                  {inStage.map((entry) => (
                    <DraggableJobTile
                      key={entry.job.id}
                      jobId={entry.job.id}
                      label={`${entry.job.title} at ${entry.job.company ?? 'an unknown company'}`}
                      className={cn('job-tile', stage === 'REJECTED' && 'is-closed')}
                    >
                      <JobName entry={entry} />
                      <JobStopLine stage={stage} />
                      <div className="next-step-row"><NextStep entry={entry} /></div>
                    </DraggableJobTile>
                  ))}
                </ul>
              ) : <p className="pipeline-empty">No jobs</p>}
            </StageDropColumn>
          )
        })}
      </div>
    </DragDropProvider>
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

/** Shown when jobs exist but the library is empty: comparing and tailoring need career evidence. */
function EmptyLibraryNote() {
  return (
    <aside className="library-note" aria-label="Your career library is empty">
      <SignalDot signal="action" />
      <p><strong>Your career library is empty.</strong> Comparisons and resumes are built from it, so they have nothing to use yet.</p>
      <Link to="/library/import">Import a resume <ArrowRight aria-hidden /></Link>
    </aside>
  )
}

/** The three steps that start a search, shown before any job is saved. Step 1 is marked done once
 * the library has content; the first unfinished step is the one to do now. */
function FirstRun({ libraryStarted }: { libraryStarted: boolean | null }) {
  return (
    <section className="home-first-run" aria-labelledby="first-run-heading">
      <h2 id="first-run-heading">Start your search in three steps</h2>
      <p className="first-run-time">Do these in order. The first comparison of a job against your library is where it starts to pay off.</p>
      <ol>
        <li data-state={libraryStarted ? 'done' : 'now'} aria-current={libraryStarted ? undefined : 'step'}>
          <h3>Fill your career library{libraryStarted && <span className="sr-only"> (done)</span>}</h3>
          {libraryStarted ? (
            <>
              <p>Your library has content. Everything you write later comes from here.</p>
              <Link to="/library">Review your library <ArrowRight aria-hidden /></Link>
            </>
          ) : (
            <>
              <p>Import a PDF or Word resume, or add details by hand. Everything you write later comes from here.</p>
              <Link to="/library/import">Import a resume <ArrowRight aria-hidden /></Link>
            </>
          )}
        </li>
        <li data-state={libraryStarted ? 'now' : 'next'} aria-current={libraryStarted ? 'step' : undefined}>
          <h3>Save a job you want</h3>
          <p>Search current listings, paste a job ad, or add a posting link.</p>
          <Link to="/jobs/find">Find jobs <ArrowRight aria-hidden /></Link>
        </li>
        <li data-state="next">
          <h3>Compare, then write</h3>
          <p>Open a saved job to see how your library matches it, answer gaps, and write a tailored resume.</p>
        </li>
      </ol>
    </section>
  )
}
