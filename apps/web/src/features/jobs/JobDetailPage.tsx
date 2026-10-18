/**
 * Description: One saved job (/jobs/:id): edit it, move its stage, delete it, or write a resume, then how the
 * career library matches it, requirements, responsibilities, nice-to-haves, notes, the description, and the
 * original posting. Requirements, responsibilities, nice-to-haves, notes, and the description start collapsed.
 * Index:
 *   - JobDetailPage: page component
 */
import { useState } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useApolloClient } from '@apollo/client/react'
import { Link, useNavigate, useParams } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { useGapAnalysis } from '@/features/gap-analysis/useGapAnalysis'
import { GapAnalysisCard } from '@/features/gap-analysis/GapAnalysisCard'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { DeleteJobDialog } from './DeleteJobDialog'
import { BulletCard, CollapsibleJobCard } from './JobDetailCards'
import { JobFormDialog } from './JobFormDialog'
import { JobStageSelect } from './JobStageSelect'
import { DELETE_JOB_MUTATION } from './jobsOperations'
import { useSaveJob } from './useSaveJob'
import { useJob } from './useJobs'
import { WriteResumeAction } from './WriteResumeAction'

/** Shows everything saved about one job, and the controls that change it. */
export function JobDetailPage() {
  const { id = '' } = useParams()
  return <JobDetails key={id} id={id} />
}

/** Keeps each job's edits and comparison subscription scoped to that job when routes change. */
function JobDetails({ id }: { id: string }) {
  const navigate = useNavigate()
  const client = useApolloClient()
  const { job, loading, error } = useJob(id)
  const comparison = useGapAnalysis(id, job?.latestGapAnalysis ?? null)
  const { save, busy, errors, clearErrors } = useSaveJob()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

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

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Button asChild variant="ghost" size="sm" className="justify-self-start">
        <Link to="/jobs">
          <ArrowLeft /> All jobs
        </Link>
      </Button>
      {error && <ErrorAlert title="Couldn't load this job" messages={[requestErrorMessage(error, error.message)]} />}
      {!job && loading && <p className="text-muted-foreground">Loading…</p>}
      {job && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
              <p className="text-muted-foreground">{[job.company ?? 'Unknown company', job.location].filter(Boolean).join(' · ')}</p>
              {job.appliedAt && <p className="text-sm text-muted-foreground">Applied {new Date(job.appliedAt).toLocaleDateString()}</p>}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <JobStageSelect jobId={job.id} stage={job.stage} />
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  clearErrors()
                  setConfirmingDelete(true)
                }}
              >
                Delete
              </Button>
              <WriteResumeAction
                jobId={job.id}
                resumeId={job.resume?.id ?? null}
                comparisonFinished={comparison.completed}
                comparisonBusy={comparison.busy}
                onCompare={() => void comparison.start()}
              />
              {job.url && (
                <Button asChild variant="outline" size="sm">
                  <a href={job.url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Original posting
                  </a>
                </Button>
              )}
            </div>
          </div>
          <JobFormDialog open={editing} job={job} onOpenChange={setEditing} />
          <DeleteJobDialog
            open={confirmingDelete}
            onOpenChange={setConfirmingDelete}
            jobTitle={job.title}
            onConfirm={() => void removeJob()}
            busy={busy}
            errors={errors}
          />
          <GapAnalysisCard jobId={job.id} comparison={comparison} gapResponses={job.gapResponses} />
          <BulletCard
            sectionId={`job.${job.id}.requirements`}
            title="Requirements"
            items={job.requirements}
            emptyText="No requirements were found in the posting."
          />
          {job.responsibilities.length > 0 && (
            <BulletCard sectionId={`job.${job.id}.responsibilities`} title="Responsibilities" items={job.responsibilities} />
          )}
          {job.niceToHaves.length > 0 && (
            <BulletCard sectionId={`job.${job.id}.nice-to-have`} title="Nice to have" items={job.niceToHaves} />
          )}
          {job.notes && (
            <CollapsibleJobCard sectionId={`job.${job.id}.notes`} title="Notes">
              <p className="text-sm whitespace-pre-line text-muted-foreground">{job.notes}</p>
            </CollapsibleJobCard>
          )}
          {job.description && (
            <CollapsibleJobCard sectionId={`job.${job.id}.description`} title="Full description">
              <p className="text-sm whitespace-pre-line text-muted-foreground">{job.description}</p>
            </CollapsibleJobCard>
          )}
        </>
      )}
    </div>
  )
}
