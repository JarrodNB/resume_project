/** Keeps saved evidence, its review note, and its next action together on one line of the page.
 * The note sits in a margin beside the text, with Improve next to the grade and answering inside
 * the box that holds the questions. On wider screens the selected detail's AI work opens right
 * under it, so a revision is read next to the words it would replace. */
import { LibraryReviewDismissActions } from './LibraryReviewDismissActions'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LibraryAssessment } from './LibraryAssessment'
import { LibraryInlineWorkspace } from './LibraryAiWorkspace'
import { LibraryEditControl } from './LibraryEditControl'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { targetElementId, targetKey } from './libraryReviewTargets'

export function LibraryDetail({ kind, recordId, text, disabled = false }: { kind: string; recordId: string; text: string; disabled?: boolean }) {
  const workspace = useLibraryWorkspace()
  const target = workspace.targets.find((item) => item.kind === kind && item.recordId === recordId)
  const selected = workspace.selectedKey === targetKey({ kind, recordId })
  const assessment = target && workspace.reviews[target.section].assessments.find((item) => item.kind === kind && item.recordId === recordId)
  return <div id={targetElementId({ kind, recordId })} className="library-detail" data-selected={selected || undefined}>
    <div className="library-detail-row">
      <p className="library-detail-text">{text}</p>
      <div className="library-detail-note">
        <LibraryAssessment assessment={assessment} action={<LibraryEditControl kind={kind} recordId={recordId} disabled={disabled} />} answerAction={assessment?.question && assessment.reviewTaskId && !assessment.stale && target ? <Button size="sm" className="w-full" aria-controls="library-ai-workspace" aria-pressed={selected && workspace.mode === 'review'} disabled={disabled} onClick={(event) => workspace.selectTarget(target, event.currentTarget, 'review')}><MessageSquare aria-hidden="true" />{(assessment.questions?.length ?? 0) > 1 ? 'Answer review questions' : 'Answer review question'}</Button> : undefined} />
        <LibraryReviewDismissActions kind={kind} recordId={recordId} disabled={disabled} />
      </div>
    </div>
    {selected && <LibraryInlineWorkspace />}
  </div>
}
