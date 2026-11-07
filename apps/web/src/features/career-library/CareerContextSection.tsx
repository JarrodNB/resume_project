/**
 * Description: The career context entries section of the career library: the list, add, and edit.
 * It sits off the career line because these answers support resume wording without becoming a separate section.
 * Reviews and regeneration apply to responses while requirement labels remain unchanged.
 * Index:
 *   - CareerContextSection: career context entries with the context form
 */
import { useState } from 'react'
import { LibrarySectionReview } from './LibrarySectionReview'
import { CareerContextFormDialog } from './CareerContextFormDialog'
import { CareerContextList, type CareerContext } from './CareerContextList'
import { LibrarySection } from './LibrarySection'
import { LIBRARY_SECTION_ANCHORS } from './librarySectionLinks'

/** Lists career context entries and opens the form to add one or edit one. */
export function CareerContextSection({ careerContexts }: { careerContexts: CareerContext[] }) {
  const [editing, setEditing] = useState<CareerContext | 'new' | null>(null)

  return (
    <>
      <LibrarySection sectionId={LIBRARY_SECTION_ANCHORS.career_contexts} offLine note="Your answers can support resume bullets and summaries. Career context does not appear as a separate resume section." title="Career context" count={careerContexts.length} emptyText="No career context yet." addLabel="Add career context" onAdd={() => setEditing('new')}
        reviewActions={<LibrarySectionReview section="career_contexts" />} reviewSection="career_contexts">

        <CareerContextList careerContexts={careerContexts} onEdit={setEditing} />
      </LibrarySection>
      <CareerContextFormDialog open={editing !== null} context={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
