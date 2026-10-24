/**
 * Description: Letter-size preview of the resume PDF at actual size. It redraws
 * after the draft settles, using the same document a later export downloads.
 * Index:
 *   - ResumePdfPreview: the preview frame
 */
import { useEffect, useState } from 'react'
import { usePDF } from '@react-pdf/renderer'
import { ResumePdfDocument } from './ResumePdfDocument'

const PREVIEW_DELAY_MS = 400
// Hide the viewer's page list and toolbar so the page fills the frame.
const PREVIEW_SRC_OPTIONS = '#toolbar=0&navpanes=0&zoom=100'

/** Shows the resume PDF. Typing waits briefly so the document is not rebuilt on every key. */
export function ResumePdfPreview({ model }: { model: string }) {
  const debounced = useDebounced(model, PREVIEW_DELAY_MS)
  const [instance, update] = usePDF()

  useEffect(() => {
    update(<ResumePdfDocument model={debounced} />)
  }, [debounced, update])

  return instance.url ? (
    <iframe
      title="Resume preview"
      src={`${instance.url}${PREVIEW_SRC_OPTIONS}`}
      className="min-h-0 w-full flex-1 rounded-md border bg-white"
    />
  ) : (
    <div className="grid min-h-0 w-full flex-1 place-items-center rounded-md border bg-white text-sm text-muted-foreground">
      {instance.error ? "Couldn't draw the preview." : 'Preparing preview…'}
    </div>
  )
}

/** Holds a value until it stops changing. The first value is kept immediately. */
function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    if (value === debounced) return
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [value, delayMs, debounced])

  return debounced
}
