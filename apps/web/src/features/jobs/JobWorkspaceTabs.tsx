/** The Fit, Study, and Posting tabs of a saved job's workspace.
 * Each tab reads the job (and the shared comparison) from `useJobWorkspace`. A tab's main
 * content stays open; only the long full description collapses.
 */
import { Button } from '@/components/ui/button'
import { FormattedDescription } from '@/components/FormattedDescription'
import { GapAnalysisCard } from '@/features/gap-analysis/GapAnalysisCard'
import { StudyGuidePanel } from '@/features/study-guides/StudyGuidePanel'
import { CollapsibleJobCard } from './JobDetailCards'
import { SkillMatches } from './SkillMatches'
import { useJobWorkspace } from './useJobWorkspace'

/** How the career library matches this job, with gap answers. */
export function JobFitTab() {
  const { job, comparison, onEditJob, onAddDescription = onEditJob } = useJobWorkspace()
  return (
    <div className="grid gap-7">
      <GapAnalysisCard
        jobId={job.id}
        comparison={comparison}
        gapResponses={job.gapResponses}
        dismissedRequirements={job.dismissedRequirements}
        hasDescription={Boolean(job.description?.trim())}
        hasRequirements={job.requirements.length > 0 || job.niceToHaves.length > 0}
        onAddDescription={onAddDescription}
        onEditRequirements={onEditJob}
      />
      <SkillMatches description={job.description} onAddDescription={onAddDescription} />
    </div>
  )
}

/** Study guides built from this job's description. */
export function JobStudyTab() {
  const { job, onEditJob, onAddDescription = onEditJob } = useJobWorkspace()
  return <StudyGuidePanel jobId={job.id} description={job.description} onAddDescription={onAddDescription} />
}

/** What the posting asks for, the user's notes, and the full description. */
export function JobPostingTab() {
  const { job, onEditJob, onAddDescription = onEditJob } = useJobWorkspace()
  return (
    <div className="job-posting">
      <PostingList title="Requirements" items={job.requirements} emptyText="No requirements were found in the posting." />
      {job.responsibilities.length > 0 && <PostingList title="Responsibilities" items={job.responsibilities} />}
      {job.niceToHaves.length > 0 && <PostingList title="Nice to have" items={job.niceToHaves} />}
      {job.notes && (
        <section>
          <h2>Notes</h2>
          <p className="whitespace-pre-line">{job.notes}</p>
        </section>
      )}
      {!job.description?.trim() && (
        <section>
          <h2>Description</h2>
          <p className="text-muted-foreground">This job has no description yet. Fit and Study need one.</p>
          <Button type="button" variant="outline" className="mt-3" onClick={onAddDescription}>Add description</Button>
        </section>
      )}
      {job.description && (
        <CollapsibleJobCard sectionId={`job.${job.id}.description`} title="Full description">
          <FormattedDescription className="text-sm text-muted-foreground" text={job.description} />
        </CollapsibleJobCard>
      )}
    </div>
  )
}

function PostingList({ title, items, emptyText }: { title: string; items: string[]; emptyText?: string }) {
  return (
    <section>
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{emptyText}</p>
      ) : (
        <ul>
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      )}
    </section>
  )
}
