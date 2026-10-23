/** Explain Word pagination separately from the native PDF preview. */
import { Button } from '@/components/ui/button'
import type { useResumeDocxCheck } from './useResumeDocxCheck'
export function ResumeDocxStatus({ check, targetPageCount, onDownload, downloadDisabled = false }: {
  check: ReturnType<typeof useResumeDocxCheck>; targetPageCount: number; onDownload?: () => void; downloadDisabled?: boolean
}) {
  const { status, pageCount } = check.state
  return <div className="grid gap-2 text-sm text-muted-foreground">
    <p>Careergrind checks the DOCX on its server with LibreOffice. Microsoft Word may paginate differently.</p>
    <p aria-live="polite">{status === 'completed'
      ? `DOCX (LibreOffice): ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} · Target: ${targetPageCount} ${targetPageCount === 1 ? 'page' : 'pages'}`
      : status === 'checking' ? 'Checking DOCX pages…' : 'DOCX page count unavailable.'}</p>
    {status === 'completed' && pageCount! > targetPageCount && <p className="text-foreground">DOCX is longer than your target. You can still download the full resume.</p>}
    <div className="flex flex-wrap gap-2">
      {(status === 'idle' || status === 'unavailable') && <Button type="button" variant="outline" onClick={() => { void check.prepare(true).catch(() => {}) }}>Retry DOCX page check</Button>}
      {onDownload && <Button type="button" variant="outline" disabled={downloadDisabled} onClick={onDownload}>Download DOCX anyway</Button>}
    </div>
  </div>
}
