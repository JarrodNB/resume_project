/** Opens one saved detail's AI work under it (or in the phone dialog) without leaving the record. */
import { PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'

export function LibraryEditControl({ kind, recordId, disabled = false }: { kind: string; recordId: string; disabled?: boolean }) {
  const workspace = useLibraryWorkspace()
  const target = workspace.targets.find((item) => item.kind === kind && item.recordId === recordId)
  return <Button size="sm" variant="ghost" className="library-improve text-muted-foreground hover:text-primary aria-pressed:bg-secondary aria-pressed:text-primary" aria-label="Improve with AI" disabled={disabled || !target} aria-controls="library-ai-workspace" aria-pressed={workspace.selectedKey === `${kind}:${recordId}` && workspace.mode === 'improve'} onClick={(event) => target && workspace.selectTarget(target, event.currentTarget)}><PencilLine aria-hidden="true" />Improve</Button>
}
