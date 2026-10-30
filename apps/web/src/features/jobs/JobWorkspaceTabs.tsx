/** The Fit, Study, and Posting tabs of a saved job's workspace.
 * Each tab reads the job (and the shared comparison) from `useJobWorkspace`. A tab's main
 * content stays open; only the long full description collapses.
 */
import { FormattedDescription } from '@/components/FormattedDescription'
import { GapAnalysisCard } from '@/features/gap-analysis/GapAnalysisCard'
import { StudyGuidePanel } from '@/features/study-guides/StudyGuidePanel'
import { CollapsibleJobCard } from './JobDetailCards'
import { SkillMatches } from './SkillMatches'
import { useJobWorkspace } from './useJobWorkspace'

/** How the career library matches this job, with gap answers. */
export function JobFitTab() {
  const { job, comparison } = useJobWorkspace()
  return (
    <div className="grid gap-4">
      <SkillMatches description={job.description} />
      <GapAnalysisCard jobId={job.id} comparison={comparison} gapResponses={job.gapResponses} />
    </div>
  )
}

/** Study guides built from this job's description. */
export function JobStudyTab() {
  const { job } = useJobWorkspace()
  return <StudyGuidePanel jobId={job.id} description={job.description} />
}

/** What the posting asks for, the user's notes, and the full description. */
export function JobPostingTab() {
  const { job } = useJobWorkspace()
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
