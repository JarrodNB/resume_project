/** Shows only the selected career detail’s editing exchange in the docked workspace.
 * Small screens use a full-screen dialog with focus containment and a return to the library.
 */
import { useSyncExternalStore } from 'react'
import { PencilLine, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { targetKey } from './libraryReviewTargets'
import { LibraryAssessment } from './LibraryAssessment'
import { LibraryEditPanel } from './LibraryEditPanel'

const mobileQuery = '(max-width: 899px)'
function subscribeMobile(callback: () => void) {
  const query = window.matchMedia?.(mobileQuery)
  query?.addEventListener('change', callback)
  return () => query?.removeEventListener('change', callback)
}
function isMobile() { return window.matchMedia?.(mobileQuery).matches ?? false }
function desktopDefault() { return false }

export function LibraryAiWorkspace() {
  const workspace = useLibraryWorkspace()
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, desktopDefault)
  if (mobile) return <Dialog open={workspace.mobileOpen} onOpenChange={(open) => { if (!open) workspace.close() }}>
    <DialogContent className="library-ai-mobile" showCloseButton={false} onCloseAutoFocus={(event) => event.preventDefault()}>
      <DialogTitle className="sr-only">Career library AI workspace</DialogTitle>
      <DialogDescription className="sr-only">Review saved career details and choose which revisions to keep.</DialogDescription>
      <WorkspaceContent mobile />
    </DialogContent>
  </Dialog>
  return <aside className="library-ai-dock" aria-label="AI workspace"><WorkspaceContent /></aside>
}

function WorkspaceContent({ mobile = false }: { mobile?: boolean }) {
  const workspace = useLibraryWorkspace()
  const selected = workspace.targets.find((target) => targetKey(target) === workspace.selectedKey)
  const review = selected && workspace.reviews[selected.section]
  const assessment = review?.assessments.find((item) => item.kind === selected?.kind && item.recordId === selected?.recordId)
  const disabled = workspace.movingHighlight && selected?.section === 'experience'
  return <div id="library-ai-workspace">
    <div className="library-ai-heading">
      <h2 id="library-ai-heading" tabIndex={-1}><PencilLine aria-hidden="true" />Improve with AI</h2>
      {(mobile || workspace.selectedKey) && <Button size="icon-sm" variant="ghost" aria-label="Close AI workspace" onClick={workspace.close}><X aria-hidden="true" /></Button>}
    </div>
    <div className="library-ai-body">
      {workspace.selectedKey ? selected ? <>
        <div className="border-b pb-4"><h3 className="text-base font-semibold">{selected.title}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.fieldLabel} · selected in your library</p></div>
        {mobile && <details className="border-b pb-4 text-sm"><summary className="cursor-pointer font-medium">View saved text</summary><p className="mt-3 whitespace-pre-wrap leading-relaxed">{selected.text}</p></details>}
        <LibraryAssessment assessment={workspace.mode === 'review' && assessment ? { ...assessment, question: null } : assessment} />
        {disabled && <p role="status" className="text-sm text-muted-foreground">Wait for the highlight move to finish before editing.</p>}
        <LibraryEditPanel key={`${targetKey(selected)}:${workspace.mode}`} reviewQuestion={workspace.mode === 'review' && assessment?.question && assessment.reviewTaskId ? { reviewTaskId: assessment.reviewTaskId, question: assessment.question, stale: assessment.stale } : undefined} kind={selected.kind} recordId={selected.recordId} sourceRevision={selected.sourceRevision} disabled={disabled} onClose={workspace.close} />
      </> : <>
        <p role="status">This detail is no longer in your library.</p>
        <Button variant="outline" onClick={workspace.close}>Back to library</Button>
      </> : <>
        <p className="text-sm leading-relaxed text-muted-foreground">Select a detail in your library to improve it with AI.</p>
      </>}
    </div>
  </div>
}
