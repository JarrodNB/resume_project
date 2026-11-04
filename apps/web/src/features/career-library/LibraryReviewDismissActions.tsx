/** Lets users retire saved questions or feedback without generating another draft. */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { targetKey } from './libraryReviewTargets'

export function LibraryReviewDismissActions({ kind, recordId, disabled = false }: { kind: string; recordId: string; disabled?: boolean }) {
  const workspace = useLibraryWorkspace()
  const target = workspace.targets.find((item) => item.kind === kind && item.recordId === recordId)
  if (!target) return null
  const review = workspace.reviews[target.section]
  const assessment = review.assessments.find((item) => item.kind === kind && item.recordId === recordId)
  if (!assessment?.reviewTaskId || assessment.stale) return null
  const reviewTaskId = assessment.reviewTaskId
  async function dismiss(scope: 'questions' | 'review') {
    if (await review.dismiss(reviewTaskId, kind, recordId, scope) && workspace.selectedKey === targetKey({ kind, recordId }) && workspace.mode === 'review') workspace.close()
  }
  return <div className="grid gap-2">
    <ErrorAlert title="Could not dismiss this review" messages={review.errors} />
    <div className="flex flex-wrap gap-2">
      {assessment.question && <Button size="sm" variant="ghost" disabled={disabled || review.dismissing} onClick={() => void dismiss('questions')}>Nothing to add</Button>}
      <Button size="sm" variant="ghost" disabled={disabled || review.dismissing} onClick={() => void dismiss('review')}>Dismiss review</Button>
    </div>
  </div>
}
