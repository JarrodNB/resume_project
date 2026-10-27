/**
 * Description: The facts section of the career library: the list, add, and edit.
 * Reviews and regeneration apply to responses while requirement labels remain unchanged.
 * Index:
 *   - FactsSection: facts with the fact form
 */
import { useState } from 'react'
import { LibrarySectionReview } from './LibrarySectionReview'
import { FactFormDialog } from './FactFormDialog'
import { FactList, type LibraryFact } from './FactList'
import { LibrarySection } from './LibrarySection'

/** Lists facts and opens the form to add one or edit one. */
export function FactsSection({ facts }: { facts: LibraryFact[] }) {
  const [editing, setEditing] = useState<LibraryFact | 'new' | null>(null)

  return (
    <>
      <LibrarySection sectionId="library.facts" tone="facts" title="Facts" count={facts.length} emptyText="No facts yet." addLabel="Add fact" onAdd={() => setEditing('new')}
        reviewActions={<LibrarySectionReview section="facts" />} reviewSection="facts">

        <FactList facts={facts} onEdit={setEditing} />
      </LibrarySection>
      <FactFormDialog open={editing !== null} fact={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
