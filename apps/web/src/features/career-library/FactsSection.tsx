/**
 * Description: The facts section of the career library: the list, add, and edit.
 * Reviews and regeneration apply to responses while requirement labels remain unchanged.
 * Index:
 *   - FactsSection: facts with the fact form
 */
import { useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { useLibraryReview } from './useLibraryReview'
import { FactFormDialog } from './FactFormDialog'
import { FactList, type LibraryFact } from './FactList'
import { LibrarySection } from './LibrarySection'

/** Lists facts and opens the form to add one or edit one. */
export function FactsSection({ facts }: { facts: LibraryFact[] }) {
  const review = useLibraryReview('facts', JSON.stringify(facts))
  const [editing, setEditing] = useState<LibraryFact | 'new' | null>(null)

  return (
    <>
      <LibrarySection sectionId="library.facts" tone="facts" title="Facts" count={facts.length} emptyText="No facts yet." addLabel="Add fact" onAdd={() => setEditing('new')}
        reviewActions={<Button variant="outline" size="sm" onClick={() => void review.start()} disabled={review.busy || !facts.length}>{review.busy ? 'Reviewing…' : 'Review Facts'}</Button>}>
        <ErrorAlert title="Could not review Facts" messages={review.errors} />
        <FactList facts={facts} onEdit={setEditing} assessments={review.assessments} />
      </LibrarySection>
      <FactFormDialog open={editing !== null} fact={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
