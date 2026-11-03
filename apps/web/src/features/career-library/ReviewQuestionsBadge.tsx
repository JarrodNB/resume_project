/** A red "needs you" count beside a library section's heading for review questions waiting on an
 * answer. A long page can hide a question far below the heading, so the section says it holds one.
 * Shows nothing when the section has no open questions.
 */
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { hasOpenQuestion, type ReviewSection } from './libraryReviewTargets'

export function ReviewQuestionsBadge({ section }: { section: ReviewSection }) {
  const workspace = useLibraryWorkspace()
  const waiting = workspace.reviews[section].assessments.filter(hasOpenQuestion).length
  if (waiting === 0) return null
  return <span className="review-questions-badge"><span className="signal-dot is-action" aria-hidden />{waiting === 1 ? '1 question for you' : `${waiting} questions for you`}</span>
}
