/** Opens one saved detail in the shared AI workspace without nesting an editor in the record. */
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'

export function LibraryEditControl({ kind, recordId, disabled = false }: { kind: string; recordId: string; disabled?: boolean }) {
  const workspace = useLibraryWorkspace()
  const target = workspace.targets.find((item) => item.kind === kind && item.recordId === recordId)
  return <Button size="sm" variant="ghost" className="text-primary" disabled={disabled || !target} aria-controls="library-ai-workspace" onClick={(event) => target && workspace.selectTarget(target, event.currentTarget)}>Improve with AI<ArrowRight aria-hidden="true" /></Button>
}
