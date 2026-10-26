/** Keeps saved evidence, its grade, and its next review action together.
 * Improvement sits beside the grade; answering sits directly beneath the questions. */
import { MessageSquare } from 'lucide-react'
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
    <div className="mt-2 grid gap-2">
      <LibraryAssessment assessment={assessment} compact action={<LibraryEditControl kind={kind} recordId={recordId} disabled={disabled} />} />
      {assessment?.question && assessment.reviewTaskId && !assessment.stale && target && <Button size="sm" variant="ghost" className="justify-self-start text-primary aria-pressed:bg-secondary" aria-controls="library-ai-workspace" aria-pressed={selected && workspace.mode === 'review'} disabled={disabled} onClick={(event) => workspace.selectTarget(target, event.currentTarget, 'review')}><MessageSquare aria-hidden="true" />{(assessment.questions?.length ?? 0) > 1 ? 'Answer review questions' : 'Answer review question'}</Button>}
    </div>
  </div>
}
