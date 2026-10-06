/**
 * Description: The education section of the career library: the dated list, add, and edit.
 * Index:
 *   - EducationSection: schools with merge/delete and the education form
 */
import { useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { formatDateRange } from '@/lib/formatDateRange'
import { EducationFormDialog } from './EducationFormDialog'
import { LibraryEntry } from './LibraryEntry'
import { LibraryEntryActions } from './LibraryEntryActions'
import { educationLabel } from './libraryEntryLabels'
import { LibrarySection } from './LibrarySection'

type Education = CareerLibraryQuery['educations'][number]

/** Lists education entries and opens the form to add one or edit one. */
export function EducationSection({ educations }: { educations: Education[] }) {
  const [editing, setEditing] = useState<Education | 'new' | null>(null)
  const candidates = educations.map((education) => ({ id: education.id, label: educationLabel(education) }))

  return (
    <>
      <LibrarySection
        sectionId="library.education"
        tone="education"
        title="Education"
        count={educations.length}
        emptyText="No education yet."
        addLabel="Add education"
        onAdd={() => setEditing('new')}
      >
        {educations.map((education, index) => (
          <LibraryEntry
            key={education.id}
            tone="education"
            heading={education.institution}
            subheading={[education.degree, education.fieldOfStudy].filter(Boolean).join(', ')}
            dates={formatDateRange(education.startDate, education.endDate)}
            description={education.description}
            actions={
              <LibraryEntryActions
                kind="education"
                entryId={education.id}
                entryLabel={candidates[index].label}
                mergeCandidates={candidates.filter((candidate) => candidate.id !== education.id)}
                onEdit={() => setEditing(education)}
              />
            }
          />
        ))}
      </LibrarySection>
      <EducationFormDialog open={editing !== null} education={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
