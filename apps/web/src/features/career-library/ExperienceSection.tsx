/**
 * Description: The experience section of the career library: the dated list, add, and edit.
 * Index:
 *   - ExperienceSection: roles with draggable highlights, merge/delete, and the role form
 */
import { useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { formatDateRange } from '@/lib/formatDateRange'
import { ExperienceFormDialog } from './ExperienceFormDialog'
import { LibraryEntry } from './LibraryEntry'
import { LibraryEntryActions } from './LibraryEntryActions'
import { experienceLabel } from './libraryEntryLabels'
import { LibrarySection } from './LibrarySection'
import { SortableHighlightList } from './SortableHighlightList'

type Experience = CareerLibraryQuery['experiences'][number]
type Highlight = Experience["highlights"][number]

interface ExperienceSectionProps {
  experiences: Experience[]
  highlightsOf: (experienceId: string, roleId?: string | null) => Highlight[]
}

/** Lists roles and opens the form to add one or edit one. */
export function ExperienceSection({ experiences, highlightsOf }: ExperienceSectionProps) {
  const [editing, setEditing] = useState<Experience | 'new' | null>(null)
  const candidates = experiences.map((experience) => ({ id: experience.id, label: experienceLabel(experience) }))
  const experience = editing && editing !== 'new' ? editing : null

  return (
    <>
      <LibrarySection sectionId="library.experience" tone="experience" title="Experience" count={experiences.length} emptyText="No experiences yet." addLabel="Add experience" onAdd={() => setEditing('new')}>
        {experiences.map((entry, index) => (
          <LibraryEntry
            key={entry.id}
            tone="experience"
            heading={entry.roles.length > 1 ? entry.company : entry.roles[0].title}
            subheading={[...(entry.roles.length > 1 ? [] : [entry.company]), entry.location].filter(Boolean).join(' · ')}
            dates={entry.roles.length > 1 ? undefined : formatDateRange(entry.roles[0].startDate, entry.roles[0].endDate, { openEndedMeansPresent: true })}
            description={entry.description}
            actions={
              <LibraryEntryActions
                kind="experience"
                entryId={entry.id}
                entryLabel={candidates[index].label}
                mergeCandidates={candidates.filter((candidate) => candidate.id !== entry.id)}
                onEdit={() => setEditing(entry)}
              />
            }
          >
            {<div className="grid gap-5">
              {entry.roles.map((role) => <section key={role.id} aria-label={role.title} className="min-w-0">
                {entry.roles.length > 1 && <><h4 className="text-sm font-medium">{role.title}</h4><p className="text-xs text-muted-foreground">{formatDateRange(role.startDate, role.endDate, {openEndedMeansPresent: true})}</p></>}
                {role.description && <p className="whitespace-pre-wrap text-sm">{role.description}</p>}
                <SortableHighlightList experienceId={`${entry.id}/${role.id}`} highlights={highlightsOf(entry.id, role.id)} />
              </section>)}
              {(entry.roles.length > 1 || entry.highlights.some((bullet) => !bullet.experienceRoleId)) && <section aria-label="Shared highlights">
                <h4 className="text-sm font-medium">Shared highlights</h4>
                <SortableHighlightList experienceId={`${entry.id}/shared`} highlights={highlightsOf(entry.id, null)} />
              </section>}
            </div>}
          </LibraryEntry>
        ))}
      </LibrarySection>
      <ExperienceFormDialog open={editing !== null} experience={experience} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
