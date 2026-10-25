/** Keeps saved career evidence readable and marks the detail open in the AI workspace. */
import { Button } from '@/components/ui/button'
import { LibraryAssessment } from './LibraryAssessment'
import { LibraryEditControl } from './LibraryEditControl'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { targetElementId, targetKey } from './libraryReviewTargets'

export function LibraryDetail({ kind, recordId, text, disabled = false }: { kind: string; recordId: string; text: string; disabled?: boolean }) {
  const workspace = useLibraryWorkspace()
  const target = workspace.targets.find((item) => item.kind === kind && item.recordId === recordId)
  const selected = workspace.selectedKey === targetKey({ kind, recordId })
  const assessment = target && workspace.reviews[target.section].assessments.find((item) => item.kind === kind && item.recordId === recordId)
  return <div id={targetElementId({ kind, recordId })} className="library-detail" data-selected={selected || undefined}>
    <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <LibraryAssessment assessment={assessment} compact />
      <div className="flex flex-wrap gap-1">
        {assessment?.question && assessment.reviewTaskId && !assessment.stale && target && <Button size="sm" variant="outline" disabled={disabled} onClick={(event) => workspace.selectTarget(target, event.currentTarget, 'review')}>{(assessment.questions?.length ?? 0) > 1 ? 'Answer review questions' : 'Answer review question'}</Button>}
        <LibraryEditControl kind={kind} recordId={recordId} disabled={disabled} />
      </div>
    </div>
  </div>
}
