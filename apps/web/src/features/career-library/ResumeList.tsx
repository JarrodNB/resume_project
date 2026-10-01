/**
 * Description: The user's resumes (base and tailored), most recently updated first.
 * Index:
 *   - ResumeList: one row per resume with kind, section count, and last update
 */
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'

type ResumeSummary = CareerLibraryQuery['resumes'][number]

const UPDATED_AT = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/** Lists resumes as rows. */
export function ResumeList({ resumes }: { resumes: ResumeSummary[] }) {
  return (
    <ul className="grid gap-2">
      {resumes.map((resume) => (
        <li key={resume.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
          <FileText className="size-5 text-muted-foreground" />
          <div className="grid flex-1">
            <span className="font-medium">{resume.title}</span>
            <span className="text-xs text-muted-foreground">
              {resume.sections.length} sections · updated {UPDATED_AT.format(new Date(resume.updatedAt))}
            </span>
          </div>
          <Badge variant="outline">{resume.kind === 'BASE' ? 'Base' : 'Tailored'}</Badge>
        </li>
      ))}
    </ul>
  )
}
