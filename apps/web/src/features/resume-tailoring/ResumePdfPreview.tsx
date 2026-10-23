/** Show the current resume PDF and its measured pagination together.
 * The count comes from the same render as the displayed file, using the export layout.
 */
import { useEffect, useState } from 'react'
import { generateResumePdfArtifact } from './resumeDownload'
import type { ResumePdfModel } from './resumePdfModel'

const PREVIEW_SRC_OPTIONS = '#toolbar=0&navpanes=0&zoom=100'
type PreviewResult = { url: string; pageCount: number }

/** PDF overflow is guidance: saving and downloading remain available. */
export function ResumePdfPreview({ model, targetPageCount = 2 }: { model: ResumePdfModel; targetPageCount?: number }) {
  const snapshot = JSON.stringify(model)
  // Remount on content changes: even restoring an old draft needs a fresh object URL.
  return <PdfSnapshot key={snapshot} snapshot={snapshot} targetPageCount={targetPageCount} />
}

function PdfSnapshot({ snapshot, targetPageCount }: { snapshot: string; targetPageCount: number }) {
  const [failed, setFailed] = useState(false)
  const [result, setResult] = useState<PreviewResult | null>(null)
  useEffect(() => {
    let active = true
    let url: string | undefined
    const timeout = window.setTimeout(() => {
      void generateResumePdfArtifact(JSON.parse(snapshot) as ResumePdfModel).then(({ blob, pageCount }) => {
        if (!active) return
        url = URL.createObjectURL(blob)
        setResult({ url, pageCount })
      }).catch(() => { if (active) setFailed(true) })
    }, 400)
    return () => {
      active = false
      window.clearTimeout(timeout)
      if (url) URL.revokeObjectURL(url)
    }
  }, [snapshot])

  return <>
    <div role="status" className="text-sm text-muted-foreground">
      {result ? <>
        <p>PDF: {pages(result.pageCount)} · Target: {pages(targetPageCount)}</p>
        {result.pageCount > targetPageCount && <p className="mt-1 text-foreground">Longer than your target. You can still save and download the full resume.</p>}
      </> : <p>{failed ? "Couldn't count PDF pages. Close and reopen the preview to try again." : 'Counting PDF pages…'}</p>}
    </div>
    {result ? <iframe title="Resume preview" src={`${result.url}${PREVIEW_SRC_OPTIONS}`} className="min-h-0 w-full flex-1 rounded-md border bg-white" /> :
      <div className="grid min-h-0 w-full flex-1 place-items-center rounded-md border bg-white text-sm text-muted-foreground">{failed ? "Couldn't draw the preview." : 'Preparing preview…'}</div>}
  </>
}

function pages(count: number): string { return `${count} ${count === 1 ? 'page' : 'pages'}` }
