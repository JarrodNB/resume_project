/** The workspace for one saved job (/jobs/:id and its tabs).
 *
 * A fixed header shows the job, its application stage, the resume action, and a menu to edit,
 * visit, or delete it. Tabs below split the work for this job: Fit (how the career library
 * matches), Resume, Study, Interview, and Posting. The header and tabs share one loaded job and
 * one live comparison, handed to each tab through `useJobWorkspace`.
 */
import { useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { useGapAnalysis } from '@/features/gap-analysis/useGapAnalysis'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { cn } from '@/lib/utils'
import { DeleteJobDialog } from './DeleteJobDialog'
import { JobActionsMenu } from './JobActionsMenu'
import { JobBoardImportNotice } from './JobBoardImportNotice'
import { JobFormDialog } from './JobFormDialog'
import { JobStageSelect } from './JobStageSelect'
import { DELETE_JOB_MUTATION } from './jobsOperations'
import { useJob } from './useJobs'
import { useSaveJob } from './useSaveJob'
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
  const client = useApolloClient()
  const { pathname } = useLocation()
  const { job, loading, error, refresh } = useJob(id)
  const comparison = useGapAnalysis(id, job?.latestGapAnalysis ?? null)
  const { save, busy, errors, clearErrors } = useSaveJob()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const base = `/jobs/${id}`
  const currentTab = pathname.slice(base.length + 1).split('/')[0]

  /** Removes the job and returns to the list. The open job is not refetched: it is already gone. */
  async function removeJob() {
    if (!job) return
    const result = await save(DELETE_JOB_MUTATION, { id: job.id }, [])
    if (!result.ok) return
    client.cache.modify({
      fields: {
        jobs(existing, { readField }) {
          if (!Array.isArray(existing)) return existing
          return existing.filter((jobRef) => readField('id', jobRef) !== job.id)
        },
      },
    })
    navigate('/jobs')
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
  if (!job) return loading ? <p role="status" className="text-muted-foreground">Loading job…</p> : null

  return (
    <div className="job-workspace">
      <JobBoardImportNotice jobId={id} />
      <header className="job-workspace-header">
        <div className="job-workspace-title">
          <h1>{job.title}</h1>
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
              onCompare={() => void comparison.start()}
            />
          )}
          <JobActionsMenu
            url={job.url}
            onEdit={() => setEditing(true)}
            onDelete={() => {
              clearErrors()
              setConfirmingDelete(true)
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
      <JobFormDialog open={editing} job={job} onOpenChange={setEditing} />
      <DeleteJobDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        jobTitle={job.title}
        onConfirm={() => void removeJob()}
        busy={busy}
        errors={errors}
      />
      <div className="job-workspace-panel">
        <Outlet context={{ job, comparison } satisfies JobWorkspaceContext} />
      </div>
    </div>
  )
}
