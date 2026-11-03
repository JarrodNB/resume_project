/** Runs an explicit section review from the section's heading row, with progress and errors there.
 * Individual editing opens under each detail; review does not open a duplicate list.
 */
import { ErrorAlert } from '@/components/ErrorAlert'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { REVIEW_SECTIONS, type ReviewSection } from './libraryReviewTargets'
import { LibraryReviewControl } from './LibraryReviewControl'

export function LibrarySectionReview({ section }: { section: ReviewSection }) {
  const workspace = useLibraryWorkspace()
  const review = workspace.reviews[section]
  const disabled = !workspace.targets.some((target) => target.section === section) || (section === 'experience' && workspace.movingHighlight)
  return <>
    <LibraryReviewControl section={REVIEW_SECTIONS[section]} busy={review.busy} disabled={disabled} onReview={() => void review.start()} />
    {review.errors.length > 0 && <div className="library-section-error"><ErrorAlert title={`Could not review ${REVIEW_SECTIONS[section]}`} messages={review.errors} /></div>}
  </>
}
