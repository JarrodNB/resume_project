/** A red "needs you" count on a library section's header for review questions waiting on an answer.
 * Library sections start collapsed, so without it a question inside a closed section is easy to miss.
 * Shows nothing when the section has no open questions.
 */
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import type { ReviewSection } from './libraryReviewTargets'

export function ReviewQuestionsBadge({ section }: { section: ReviewSection }) {
  const workspace = useLibraryWorkspace()
  const waiting = workspace.reviews[section].assessments.filter((item) => item.question && item.reviewTaskId && !item.stale).length
  if (waiting === 0) return null
  return <span className="review-questions-badge"><span className="signal-dot is-action" aria-hidden />{waiting === 1 ? '1 question for you' : `${waiting} questions for you`}</span>
}
