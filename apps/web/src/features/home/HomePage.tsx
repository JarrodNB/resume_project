/** Home (/): what needs you today across applications, interview practice and the career library.
 *
 * Home stays short however many jobs are saved. A slim strip lists all AI work still running; it
 * keeps itself current and refreshes these steps when work finishes. A stage line shows how many jobs
 * sit in each stage (each station opens the Jobs list for that stage). Two lanes sit under it:
 * "Do next" lists the few jobs whose suggested application step is the user's move, furthest along
 * first, and "Practice" (see PracticePanel) offers the next interview-practice step. Jobs ready for
 * interview practice appear in Practice rather than Do next. A second row holds "Library" (see
 * LibraryHealthPanel: how well-reviewed the career library is, shown once it has content) and "This week"
 * (see WeekPanel: what the user got done in the last seven days). Rails suggests each job's next step; colors follow the signal rules in nextSteps.ts.
 * The full board and list live on the Jobs page. With no saved jobs yet, Home shows the four steps
 * that start a search, marking the career library step done once the library has content. With
 * jobs but an empty library, a red note says comparisons have nothing to compare yet.
 */
import { ContentSkeleton } from '@/components/ContentSkeleton'
import { useCallback } from 'react'
import { useQuery } from '@apollo/client/react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { JOB_STAGE_LABELS } from '@/features/jobs/jobStageLabels'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { CAREER_LIBRARY_QUERY } from '@/features/career-library/careerLibraryOperations'
import { libraryHasContent } from '@/features/career-library/libraryHasContent'
import { JOB_PIPELINE_QUERY } from './homeOperations'
import { jobsNeedingYou, type PipelineEntry } from './homeSummary'
import { AiWorkStrip } from './AiWorkStrip'
import { NextStep, SignalDot } from './NextStepSignal'
import { PipelineJobName } from './PipelineJobName'
import { LibraryHealthPanel } from './LibraryHealthPanel'
import { PracticePanel } from './PracticePanel'
import { StageLine } from './StageLine'
import { WeekPanel } from './WeekPanel'

/** How many "Do next" jobs Home lists before pointing at the Jobs page. */
export const DO_NEXT_LIMIT = 6

export function HomePage() {
  const { data, loading, error, refetch } = useQuery(JOB_PIPELINE_QUERY, { fetchPolicy: 'cache-and-network' })
  // The library only shapes the first-run guidance; Home still works if it fails or is slow.
  const { data: libraryData } = useQuery(CAREER_LIBRARY_QUERY, { fetchPolicy: 'cache-and-network' })
  const libraryStarted = libraryData ? libraryHasContent(libraryData) : null
  const entries = data?.jobPipeline ?? []
  const reloadPipeline = useCallback(() => { void refetch().catch(() => { /* The query error stays on screen. */ }) }, [refetch])

  return (
    <div className="home-page">
      <PageHeading
        title="Your job search"
        description="What needs you today: applications, practice and your library."
        actions={<>
          <Button asChild variant="outline" size="lg"><Link to="/jobs/find">Find jobs</Link></Button>
          <Button asChild size="lg"><Link to="/jobs/new">Add a job</Link></Button>
        </>}
      />
      {error && (
        <div className="grid gap-3">
          <ErrorAlert title="Couldn't load your jobs" messages={[requestErrorMessage(error, error.message)]} />
          <Button variant="outline" className="justify-self-start" disabled={loading} onClick={reloadPipeline}>Try again</Button>
        </div>
      )}
      {!data && loading && <ContentSkeleton label="Loading your jobs…" layout="sections" />}
      {data && entries.length === 0 && <FirstRun libraryStarted={libraryStarted} />}
      {entries.length > 0 && (
        <>
          {libraryStarted === false && <EmptyLibraryNote />}
          <AiWorkStrip onWorkFinished={reloadPipeline} />
          <StageLine entries={entries} />
          <div className="home-grid">
            <DoNext entries={entries} />
            <PracticePanel entries={entries} />
            {libraryData && libraryStarted && <LibraryHealthPanel library={libraryData} />}
            <WeekPanel entries={entries} />
          </div>
        </>
      )}
    </div>
  )
}

/** The jobs whose application step needs the user, capped so Home stays short; the Jobs page holds the rest.
 * Interview practice has its own lane, so those jobs are left out here. */
function DoNext({ entries }: { entries: PipelineEntry[] }) {
  const needYou = jobsNeedingYou(entries).filter((entry) => entry.nextStep !== 'PRACTICE_INTERVIEW')
  const shown = needYou.slice(0, DO_NEXT_LIMIT)
  return (
    <section className="home-lane" aria-labelledby="do-next-heading">
      <div className="lane-head">
        <h2 id="do-next-heading">Do next</h2>
        {needYou.length > 0 && <span>{needYou.length === 1 ? '1 job needs you' : `${needYou.length} jobs need you`}</span>}
      </div>
      {shown.length > 0 ? (
        <ul>
          {shown.map((entry) => (
            <li key={entry.job.id} className="pipeline-row">
              <PipelineJobName entry={entry} />
              <div className="lane-step">
                <NextStep entry={entry} />
                <span className="lane-stage">{JOB_STAGE_LABELS[entry.job.stage]}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lane-quiet lane-clear"><strong>You’re caught up.</strong> Nothing is waiting on you. Find a new job to keep the search moving.</p>
      )}
      <Link to="/jobs" className="lane-all">
        {needYou.length > shown.length ? `See all ${entries.length} jobs` : 'Open all jobs'} <ArrowRight aria-hidden />
      </Link>
    </section>
  )
}

/** Shown when jobs exist but the library is empty: comparing and tailoring need career evidence. */
function EmptyLibraryNote() {
  return (
    <aside className="library-note" aria-label="Your career library is empty">
      <SignalDot signal="action" />
      <p><strong>Your career library is empty.</strong> Comparisons and resumes are built from it, so they have nothing to use yet.</p>
      <Link to="/library">Import a resume <ArrowRight aria-hidden /></Link>
    </aside>
  )
}

/** The four steps that start a search, shown before any job is saved. Step 1 is marked done once
 * the library has content; the first unfinished step is the one to do now. */
function FirstRun({ libraryStarted }: { libraryStarted: boolean | null }) {
  return (
    <section className="home-first-run" aria-labelledby="first-run-heading">
      <h2 id="first-run-heading">Start your search in four steps</h2>
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
              <Link to="/library">Import a resume <ArrowRight aria-hidden /></Link>
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
        <li data-state="next">
          <h3>Prepare for the interview</h3>
          <p>Practice answering interview questions using your experience and the job you saved.</p>
        </li>
      </ol>
    </section>
  )
}
