/** Shows the selected career detail's editing exchange. On wider screens it opens right under the
 * detail; small screens use a full-screen dialog with focus containment and a return to the library.
 * Only one detail is selected at a time, so there is only ever one of these open.
 */
import { useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { targetKey } from './libraryReviewTargets'
import { LibraryAssessment } from './LibraryAssessment'
import { LibraryReviewDismissActions } from './LibraryReviewDismissActions'
import { LibraryEditPanel } from './LibraryEditPanel'

const mobileQuery = '(max-width: 899px)'
function subscribeMobile(callback: () => void) {
  const query = window.matchMedia?.(mobileQuery)
  query?.addEventListener('change', callback)
  return () => query?.removeEventListener('change', callback)
}
function isMobile() { return window.matchMedia?.(mobileQuery).matches ?? false }
function desktopDefault() { return false }
function useMobileLibrary() { return useSyncExternalStore(subscribeMobile, isMobile, desktopDefault) }

/** The small-screen dialog. Rendered once for the whole page. */
export function LibraryAiWorkspace() {
  const workspace = useLibraryWorkspace()
  if (!useMobileLibrary()) return null
  return <Dialog open={workspace.mobileOpen} onOpenChange={(open) => { if (!open) workspace.close() }}>
    <DialogContent className="library-ai-mobile" showCloseButton={false} onCloseAutoFocus={(event) => event.preventDefault()}>
      <DialogTitle className="sr-only">Career library AI workspace</DialogTitle>
      <DialogDescription className="sr-only">Review saved career details and choose which revisions to keep.</DialogDescription>
      <MobileWorkspaceContent />
    </DialogContent>
  </Dialog>
}

/** The wider-screen panel, rendered under the selected detail. */
export function LibraryInlineWorkspace() {
  const workspace = useLibraryWorkspace()
  const selected = workspace.targets.find((target) => targetKey(target) === workspace.selectedKey)
  if (useMobileLibrary() || !selected) return null
  return <aside id="library-ai-workspace" className="library-ai-inline" aria-label="AI workspace">
    <div className="library-ai-heading">
      <div className="min-w-0">
        <h4 id="library-ai-heading" tabIndex={-1}>Rewrite with AI</h4>
        <p>{selected.fieldLabel} · {selected.title}</p>
      </div>
      <CloseButton />
    </div>
    <SelectedEditPanel />
  </aside>
}

function MobileWorkspaceContent() {
  const workspace = useLibraryWorkspace()
  const selected = workspace.targets.find((target) => targetKey(target) === workspace.selectedKey)
  const assessment = selected && workspace.reviews[selected.section].assessments.find((item) => item.kind === selected.kind && item.recordId === selected.recordId)
  return <div id="library-ai-workspace">
    <div className="library-ai-heading">
      <h2 id="library-ai-heading" tabIndex={-1}>Rewrite with AI</h2>
      <CloseButton />
    </div>
    <div className="library-ai-body">
      {selected ? <>
        <div className="border-b pb-4"><h3 className="text-base font-semibold">{selected.title}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.fieldLabel}</p></div>
        <details className="border-b pb-4 text-sm"><summary className="cursor-pointer font-medium">View saved text</summary><p className="mt-3 whitespace-pre-wrap leading-relaxed">{selected.text}</p></details>
        <LibraryAssessment assessment={workspace.mode === 'review' && assessment ? { ...assessment, question: null, questions: [] } : assessment} />
        <SelectedEditPanel />
      </> : <>
        <p role="status">This detail is no longer in your library.</p>
        <Button variant="outline" onClick={workspace.close}>Back to library</Button>
      </>}
    </div>
  </div>
}

function CloseButton() {
  const workspace = useLibraryWorkspace()
  return <Button size="icon" variant="ghost" className="-mr-2 size-11" aria-label="Close AI workspace" onClick={workspace.close}><X aria-hidden="true" /></Button>
}

function SelectedEditPanel() {
  const workspace = useLibraryWorkspace()
  const selected = workspace.targets.find((target) => targetKey(target) === workspace.selectedKey)
  if (!selected) return null
  const assessment = workspace.reviews[selected.section].assessments.find((item) => item.kind === selected.kind && item.recordId === selected.recordId)
  const disabled = workspace.movingHighlight && selected.section === 'experience'
  return <>
    {disabled && <p role="status" className="text-sm text-muted-foreground">Wait for the highlight move to finish before editing.</p>}
    <LibraryEditPanel key={`${targetKey(selected)}:${workspace.mode}`} reviewQuestion={workspace.mode === 'review' && assessment?.question && assessment.reviewTaskId ? { reviewTaskId: assessment.reviewTaskId, questions: assessment.questions, stale: assessment.stale } : undefined} kind={selected.kind} recordId={selected.recordId} sourceRevision={selected.sourceRevision} sourceText={selected.text} reviewActions={<LibraryReviewDismissActions kind={selected.kind} recordId={selected.recordId} disabled={disabled} />} disabled={disabled} onClose={workspace.close} />
  </>
}
