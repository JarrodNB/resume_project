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
 * The full board and list live on the Jobs page. With no saved jobs, Home shows the four steps that
 * start a search (see FirstRunGuide). With exactly one saved job, the guide stays (under the AI work
 * strip, so running work shows and the steps refresh when it finishes) until the user writes a
 * tailored resume or moves the job past "not applied". While the guide shows, the page header drops
 * its buttons so the guide's current step is the one action. With jobs but an empty library, the dashboard shows a red note that comparisons have
 * nothing to compare yet.
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
import { RESUMES_QUERY } from '@/features/resumes/resumesOperations'
import { finishedFirstRun, jobsNeedingYou, type PipelineEntry } from './homeSummary'
import { FirstRunGuide } from './FirstRunGuide'
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
  // Whether any tailored resume exists decides when the first-run guide gives way to the dashboard.
  // This Week reads the same query, so the dashboard costs no extra request.
  const { data: resumesData, error: resumesError } = useQuery(RESUMES_QUERY, { fetchPolicy: 'cache-and-network' })
  const entries = data?.jobPipeline ?? []
  const reloadPipeline = useCallback(() => { void refetch().catch(() => { /* The query error stays on screen. */ }) }, [refetch])
  const finished = finishedFirstRun(entries, resumesData ? resumesData.resumes.length : null)
  // With no saved jobs there is nothing for the dashboard to show, so the guide always leads.
  const showGuide = !!data && (entries.length === 0 || (!finished && !!resumesData))
  // If resumes can't load, fall back to the dashboard rather than hiding saved jobs.
  const showDashboard = entries.length > 0 && !showGuide && (finished || !!resumesError)
  const deciding = !!data && !showGuide && !showDashboard

  return (
    <div className="home-page">
      <PageHeading
        title="Your job search"
        description={showGuide ? 'Four steps to get your search going.' : 'What needs you today: applications, practice and your library.'}
        actions={showDashboard && <>
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
      {((!data && loading) || deciding) && <ContentSkeleton label="Loading your jobs…" layout="sections" />}
      {showGuide && entries.length > 0 && <AiWorkStrip onWorkFinished={reloadPipeline} />}
      {showGuide && <FirstRunGuide libraryStarted={libraryStarted} job={entries[0] ?? null} />}
      {showDashboard && (
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
