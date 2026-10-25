/**
 * Description: The experience section of the career library: the dated list, add, and edit.
 * Section review checks descriptions and highlights; each detail has its own revision workspace.
 * Index:
 *   - ExperienceSection: roles with draggable highlights, merge/delete, and the role form
 */
import { useState } from 'react'
import { LibrarySectionReview } from './LibrarySectionReview'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { formatDateRange } from '@/lib/formatDateRange'
import { ExperienceFormDialog } from './ExperienceFormDialog'
import { LibraryEntry } from './LibraryEntry'
import { LibraryEntryActions } from './LibraryEntryActions'
import { experienceLabel } from './libraryEntryLabels'
import { LibrarySection } from './LibrarySection'
import { SortableHighlightList } from './SortableHighlightList'
import { LibraryDetail } from './LibraryDetail'

type Experience = CareerLibraryQuery['experiences'][number]
type Highlight = { id: string; content: string }

interface ExperienceSectionProps {
  movingHighlight?: boolean
  experiences: Experience[]
  highlightsOf: (experienceId: string) => Highlight[]
}

/** Lists roles and opens the form to add one or edit one. */
export function ExperienceSection({ experiences, highlightsOf, movingHighlight = false }: ExperienceSectionProps) {
  const [editing, setEditing] = useState<Experience | 'new' | null>(null)
  const candidates = experiences.map((experience) => ({ id: experience.id, label: experienceLabel(experience) }))
  const experience = editing && editing !== 'new' ? { ...editing, highlights: highlightsForForm(highlightsOf(editing.id)) } : null

  return (
    <>
      <LibrarySection sectionId="library.experience" tone="experience" title="Experience" count={experiences.length} emptyText="No roles yet." addLabel="Add role" onAdd={() => setEditing('new')}
        reviewActions={<LibrarySectionReview section="experience" />}>

        {experiences.map((entry, index) => (
          <LibraryEntry
            key={entry.id}
            tone="experience"
            heading={entry.title}
            subheading={[entry.company, entry.location].filter(Boolean).join(' · ')}
            dates={formatDateRange(entry.startDate, entry.endDate, { openEndedMeansPresent: true })}
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
            {entry.description && <LibraryDetail kind="experience" recordId={entry.id} text={entry.description} disabled={movingHighlight} />}
            <SortableHighlightList experienceId={entry.id} highlights={highlightsOf(entry.id)} movingHighlight={movingHighlight} />
          </LibraryEntry>
        ))}
      </LibrarySection>
      <ExperienceFormDialog open={editing !== null} experience={experience} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}

/** Adds the position the form's experience type requires. The form only reads the text. */
function highlightsForForm(highlights: Highlight[]) {
  return highlights.map((highlight, position) => ({ id: highlight.id, content: highlight.content, position }))
}
