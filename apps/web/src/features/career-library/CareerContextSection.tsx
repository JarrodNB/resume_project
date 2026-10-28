/**
 * Description: The career context entries section of the career library: the list, add, and edit.
 * Reviews and regeneration apply to responses while requirement labels remain unchanged.
 * Index:
 *   - CareerContextSection: career context entries with the context form
 */
import { useState } from 'react'
import { LibrarySectionReview } from './LibrarySectionReview'
import { CareerContextFormDialog } from './CareerContextFormDialog'
import { CareerContextList, type CareerContext } from './CareerContextList'
import { LibrarySection } from './LibrarySection'

/** Lists career context entries and opens the form to add one or edit one. */
export function CareerContextSection({ careerContexts }: { careerContexts: CareerContext[] }) {
  const [editing, setEditing] = useState<CareerContext | 'new' | null>(null)

  return (
    <>
      <LibrarySection sectionId="library.career_contexts" tone="career_contexts" title="Career context" count={careerContexts.length} emptyText="No career context yet." addLabel="Add career context" onAdd={() => setEditing('new')}
        reviewActions={<LibrarySectionReview section="career_contexts" />} reviewSection="career_contexts">

        <CareerContextList careerContexts={careerContexts} onEdit={setEditing} />
      </LibrarySection>
      <CareerContextFormDialog open={editing !== null} context={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
