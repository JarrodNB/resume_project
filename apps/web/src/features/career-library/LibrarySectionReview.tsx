/** Runs an explicit section review beside the saved records, with local progress and errors.
 * Individual editing stays in the right-hand workspace; review does not open a duplicate list.
 */
import { ErrorAlert } from '@/components/ErrorAlert'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { REVIEW_SECTIONS, type ReviewSection } from './libraryReviewTargets'
import { LibraryReviewControl } from './LibraryReviewControl'

export function LibrarySectionReview({ section }: { section: ReviewSection }) {
  const workspace = useLibraryWorkspace()
  const review = workspace.reviews[section]
  const disabled = !workspace.targets.some((target) => target.section === section) || (section === 'experience' && workspace.movingHighlight)
  return <div className="grid min-w-0 gap-2 justify-items-end">
    <LibraryReviewControl section={REVIEW_SECTIONS[section]} description="" busy={review.busy} disabled={disabled} onReview={() => void review.start()} />
    <ErrorAlert title={`Could not review ${REVIEW_SECTIONS[section]}`} messages={review.errors} />
  </div>
}
