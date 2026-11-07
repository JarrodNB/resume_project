/** The workspace for one saved job (/jobs/:id and its tabs).
 *
 * A fixed header shows the job, its application stage, the resume action, and a menu to edit,
 * visit, or archive it. Tabs below split the work for this job: Fit (how the career library
 * matches), Resume, Study, Interview, and Posting. The header and tabs share one loaded job and
 * one live comparison, handed to each tab through `useJobWorkspace`.
 */
import { ContentSkeleton } from '@/components/ContentSkeleton'
import { CombinedGraphQLErrors } from '@apollo/client/errors'
import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGapAnalysis } from '@/features/gap-analysis/useGapAnalysis'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { cn } from '@/lib/utils'
import { ArchiveJobDialog } from './ArchiveJobDialog'
import { JobActionsMenu } from './JobActionsMenu'
import { JobBoardImportNotice } from './JobBoardImportNotice'
import { JobImportCheckNotice } from './JobImportCheckNotice'
import { JobFormDialog } from './JobFormDialog'
import { JobStageSelect } from './JobStageSelect'
import { useArchiveJob } from './useArchiveJob'
import { useJob } from './useJobs'
import type { JobWorkspaceContext } from './useJobWorkspace'
import { WriteResumeAction } from './WriteResumeAction'

/** Each tab's path inside `/jobs/:id`; the first is the default tab. */
const JOB_TABS = [
  { path: '', label: 'Fit' },
  { path: 'resume', label: 'Resume' },
  { path: 'study', label: 'Study' },
  { path: 'interview', label: 'Interview' },
  { path: 'posting', label: 'Posting' },
]

export function JobWorkspaceLayout() {
  const { id = '' } = useParams()
  return <JobWorkspace key={id} id={id} />
}

/** Keeps each job's edits and comparison subscription scoped to that job when routes change. */
function JobWorkspace({ id }: { id: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { job, loading, error, refresh } = useJob(id)
  const comparison = useGapAnalysis(id, job?.latestGapAnalysis ?? null)
  const { archive, busy, errors, clearErrors } = useArchiveJob()
  const [editing, setEditing] = useState(false)
  const [focusDescription, setFocusDescription] = useState(false)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const base = `/jobs/${id}`
  const currentTab = pathname.slice(base.length + 1).split('/')[0]

  function openJobEditor(description = false) {
    setFocusDescription(description)
    setEditing(true)
  }

  /** Hides the job from cached lists and returns to saved jobs. */
  async function archiveJob() {
    if (!job) return
    if (!await archive(job.id)) return
    navigate('/jobs')
  }

  const missingJob = CombinedGraphQLErrors.is(error)
    && error.errors.some((item) => item.message === 'Record not found')
  if (missingJob || (!loading && !error && !job)) {
    return (
      <div className="grid gap-3">
        <ErrorAlert title="This job is unavailable" messages={['It may have been removed, or you may not have access to it.']} />
        <Button asChild variant="outline" className="justify-self-start"><Link to="/jobs">All saved jobs</Link></Button>
      </div>
    )
  }
  if (error) {
    return (
      <div className="grid gap-3">
        <ErrorAlert title="Couldn't load this job" messages={[requestErrorMessage(error, error.message)]} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={loading} onClick={() => void refresh().catch(() => { /* The query error stays on screen. */ })}>Try again</Button>
          <Button asChild variant="ghost"><Link to="/jobs">All saved jobs</Link></Button>
        </div>
      </div>
    )
  }
  if (!job) return loading ? <ContentSkeleton label="Loading job…" layout="detail" /> : null

  return (
    <div className="job-workspace">
      <JobBoardImportNotice jobId={id} />
      <JobImportCheckNotice jobId={id} />
      <header className="job-workspace-header">
        <div className="job-workspace-title">
          <h1 title={job.title}>{job.title}</h1>
          <p>{[job.company ?? 'Unknown company', job.location].filter(Boolean).join(' · ')}</p>
          {job.appliedAt && <p>Applied {new Date(job.appliedAt).toLocaleDateString()}</p>}
        </div>
        <div className="job-workspace-actions">
          <JobStageSelect jobId={job.id} stage={job.stage} />
          {/* The Resume tab offers writing itself, so the header doesn't repeat it there. */}
          {!job.resume && currentTab !== 'resume' && (
            <WriteResumeAction
              jobId={job.id}
              resumeId={null}
              comparisonFinished={comparison.completed}
              comparisonBusy={comparison.busy}
              hasDescription={Boolean(job.description?.trim())}
              hasRequirements={job.requirements.length > 0 || job.niceToHaves.length > 0}
              onCompare={() => void comparison.start()}
            />
          )}
          {job.url && (
            <Button asChild variant="outline">
              <a href={job.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> View posting</a>
            </Button>
          )}
          <JobActionsMenu
            onEdit={() => openJobEditor()}
            onArchive={() => {
              clearErrors()
              setConfirmingArchive(true)
            }}
          />
        </div>
      </header>
      <nav className="job-tabs" aria-label="Job sections">
        {JOB_TABS.map((tab) => {
          const active = tab.path === currentTab
          return (
            <Link
              key={tab.label}
              to={tab.path ? `${base}/${tab.path}` : base}
              aria-current={active ? 'page' : undefined}
              className={cn('section-tab', active && 'is-active')}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
      <JobFormDialog open={editing} job={job} focusDescription={focusDescription} onOpenChange={setEditing} />
      <ArchiveJobDialog
        open={confirmingArchive}
        onOpenChange={setConfirmingArchive}
        jobTitle={job.title}
        onConfirm={() => void archiveJob()}
        busy={busy}
        errors={errors}
      />
      <div className="job-workspace-panel">
        <Outlet context={{
          job,
          comparison,
          onEditJob: () => openJobEditor(),
          onAddDescription: () => openJobEditor(true),
        } satisfies JobWorkspaceContext} />
      </div>
    </div>
  )
}
