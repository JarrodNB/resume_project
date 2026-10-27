/** Shows vacancy expectations as job details, separate from the candidate's career evidence. */
import { SectionCard } from '@/components/SectionCard'

export interface InterviewJob {
  id?: string | null
  title: string
  company?: string | null
  description?: string | null
  requirements: string[]
  responsibilities: string[]
  niceToHaves: string[]
}

export function InterviewJobContext({ job, sectionId }: { job: InterviewJob; sectionId: string }) {
  const hasDetails = Boolean(job.description?.trim() || job.requirements.length || job.responsibilities.length || job.niceToHaves.length)
  return <div className="grid min-w-0 gap-3">
    <div className="grid gap-1"><h3 className="text-lg font-medium break-words">{job.title}</h3><p className="text-sm text-muted-foreground break-words">{job.company ?? 'Unknown company'}</p></div>
    {!hasDetails ? <p className="max-w-prose text-sm text-muted-foreground">This job only has a title and optional company. Practice will use broader role questions and your career library. Add a description or requirements to the job for more specific practice.</p> : <SectionCard tone="experience" title="Saved job details" sectionId={sectionId}>
      {job.description?.trim() && <p className="text-sm whitespace-pre-line break-words">{job.description}</p>}
      {([['Responsibilities', job.responsibilities], ['Requirements', job.requirements], ['Nice to have', job.niceToHaves]] as const).map(([label, items]) => items.length > 0 && <div key={label} className="grid gap-2">
        <h4 className="font-medium">{label}</h4><ul className="list-disc space-y-2 pl-5 text-sm">{items.map((item, index) => <li className="break-words" key={index}>{item}</li>)}</ul>
      </div>)}
    </SectionCard>}
  </div>
}
