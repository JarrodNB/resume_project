/**
 * Description: Saved jobs (/jobs), as a list grouped by stage (newest first) or as a board of stage columns (remembered per
 * browser), with ways to add one from a link, a pasted ad, or by hand. Each row shows the job's line through the stages and its
 * next step as the same signal bullet Home uses. Running work updates these steps live. `?stage=` narrows the list to one
 * stage (Home's stage line links here); the board already splits by stage, so a stage filter always shows the list.
 * Index:
 *   - JobsPage: page component
 */
import { ContentSkeleton } from '@/components/ContentSkeleton'
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { ArrowUpRight, BriefcaseBusiness, ClipboardPaste, ExternalLink, Link2 } from 'lucide-react'
import { JOB_PIPELINE_QUERY } from '@/features/home/homeOperations'
import { useRunningAiTasks } from '@/features/home/useRunningAiTasks'
import { RunningTaskSubscription } from '@/features/home/RunningTaskSubscription'
import { NextStep } from '@/features/home/NextStepSignal'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeading } from '@/components/PageHeading'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JobFormDialog } from './JobFormDialog'
import { JobsBoard } from './JobsBoard'
import { JOB_STAGE_LABELS, JOB_STAGE_ORDER, sortJobsByStage, type JobStage } from './jobStageLabels'
import { readJobsView, rememberJobsView, type JobsView } from './jobsView'
import { JobStopLine } from './JobStopLine'
import { useJobs } from './useJobs'

/** Lists the user's jobs, each linking to its detail page. */
export function JobsPage() {
  const navigate = useNavigate()
  const { jobs: loadedJobs, loading, error } = useJobs()
  const allJobs = useMemo(() => (loadedJobs ? sortJobsByStage(loadedJobs) : null), [loadedJobs])
  const [searchParams, setSearchParams] = useSearchParams()
  const stageParam = searchParams.get('stage')
  const stage = JOB_STAGE_ORDER.find((candidate) => candidate === stageParam) ?? null
  const [view, setView] = useState<JobsView>(readJobsView)
  const showBoard = view === 'board' && !stage
  const jobs = useMemo(() => (allJobs && stage ? allJobs.filter((job) => job.stage === stage) : allJobs), [allJobs, stage])
  const [adding, setAdding] = useState(false)
  // The pipeline only adds next steps; the list still works if it fails or is slow.
  const { data: pipeline, refetch: refetchPipeline } = useQuery(JOB_PIPELINE_QUERY, { fetchPolicy: 'cache-and-network' })
  const reloadPipeline = useCallback(() => { void refetchPipeline().catch(() => { /* Next steps remain optional. */ }) }, [refetchPipeline])
  const { running, checkAgain } = useRunningAiTasks(reloadPipeline)
  const pipelineByJob = new Map(pipeline?.jobPipeline.map((entry) => [entry.job.id, entry]))

  function chooseStage(next: JobStage | null) {
    setSearchParams(next ? { stage: next } : {}, { replace: true })
  }

  function chooseView(next: JobsView) {
    setView(next)
    rememberJobsView(next)
    if (next === 'board') chooseStage(null)
  }

  return (
    <div className={cn('grid gap-6', !showBoard && 'max-w-5xl')}>
      {running.map((task) => <RunningTaskSubscription key={task.id} id={task.id} onSettled={checkAgain} />)}
      <PageHeading title="Jobs" description="Keep the opportunities that matter in view. Prepare each application with intention." actions={
        <>
          <Button asChild><Link to="/jobs/new"><Link2 /> Add job from link</Link></Button>
          <Button asChild variant="outline"><Link to="/jobs/paste"><ClipboardPaste /> Paste a job ad</Link></Button>
          <Button variant="ghost" onClick={() => setAdding(true)}>Add manually</Button>
        </>
      } />
      <JobFormDialog open={adding} job={null} onOpenChange={setAdding} onCreated={(jobId) => navigate(`/jobs/${jobId}`)} />
      {error && <ErrorAlert title="Couldn't load your jobs" messages={[requestErrorMessage(error, error.message)]} />}
      {!jobs && loading && <ContentSkeleton label="Loading your jobs…" />}
      {allJobs?.length === 0 && (
        <div className="empty-records">
          <BriefcaseBusiness size={30} strokeWidth={1.4} aria-hidden />
          <h2>A place for your next opportunity</h2>
          <p>No jobs yet. Search current listings, paste a job ad or a posting link, or add one yourself. Once a job is saved you can see how your career library matches it.</p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button asChild><Link to="/jobs/find">Find jobs</Link></Button>
            <Button asChild variant="outline"><Link to="/jobs/new">Add your first job <ArrowUpRight /></Link></Button>
          </div>
        </div>
      )}
      {allJobs && allJobs.length > 0 && (
        <div className="jobs-toolbar">
          <h2>{jobCountLabel(jobs?.length ?? 0, stage)}</h2>
          {!showBoard && (
            <div className="stage-filter" role="group" aria-label="Show stage">
              <button type="button" aria-pressed={!stage} onClick={() => chooseStage(null)}>All</button>
              {JOB_STAGE_ORDER.map((option) => (
                <button key={option} type="button" aria-pressed={stage === option} onClick={() => chooseStage(option)}>{JOB_STAGE_LABELS[option]}</button>
              ))}
            </div>
          )}
          <div className="view-switch" role="group" aria-label="Show jobs as">
            <button type="button" aria-pressed={!showBoard} onClick={() => chooseView('list')}>List</button>
            <button type="button" aria-pressed={showBoard} onClick={() => chooseView('board')}>Board</button>
          </div>
        </div>
      )}
      {showBoard && allJobs && allJobs.length > 0 && (
        pipeline ? <JobsBoard entries={pipeline.jobPipeline} /> : <ContentSkeleton label="Loading your board…" layout="board" />
      )}
      {!showBoard && jobs && jobs.length === 0 && allJobs && allJobs.length > 0 && (
        <p className="pipeline-empty">No jobs in this stage.</p>
      )}
      {!showBoard && jobs && jobs.length > 0 && (
        <ul className="record-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-record">
              <Link to={`/jobs/${job.id}`} aria-label={`Open ${job.title} at ${job.company ?? 'Unknown company'}`} className="record-link focus-visible:outline-2 focus-visible:outline-ring">
                <div className="record-text">
                  <p className="font-medium">{job.title}</p>
                  <p className="text-base text-muted-foreground">
                    {[job.company ?? 'Unknown company', job.location].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <JobStopLine stage={job.stage} showLabel className="is-compact" />
                <ArrowUpRight size={17} className="record-arrow" aria-hidden />
              </Link>
              {job.url && (
                <a href={job.url} target="_blank" rel="noreferrer" className="job-record-url" aria-label={`Open ${job.title} application page`}>
                  <ExternalLink size={14} aria-hidden /> Application page
                </a>
              )}
              {pipelineByJob.get(job.id) && <div className="job-record-step"><NextStep entry={pipelineByJob.get(job.id)!} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function jobCountLabel(count: number, stage: JobStage | null) {
  const noun = count === 1 ? '1 job' : `${count} jobs`
  return stage ? `${noun} · ${JOB_STAGE_LABELS[stage]}` : noun
}
