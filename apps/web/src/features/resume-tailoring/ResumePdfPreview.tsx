/** Build the same PDF used by downloads and display it as responsive pages.
 * A short debounce avoids rebuilding on every keystroke. Each PDF URL owns its
 * viewer so completed renders cannot overwrite a newer document.
 */
import { useEffect, useState } from 'react'
import { usePDF } from '@react-pdf/renderer'
import { ResumePdfPages } from './ResumePdfPages'
import { ResumePdfDocument } from './ResumePdfDocument'
import type { ResumePdfModel } from './resumePdfModel'

const PREVIEW_DELAY_MS = 400
/** Shows the resume PDF. Typing waits briefly so the document is not rebuilt on every key. */
export function ResumePdfPreview({ model }: { model: ResumePdfModel }) {
  const debounced = useDebounced(JSON.stringify(model), PREVIEW_DELAY_MS)
  const [instance, update] = usePDF()

  useEffect(() => {
    update(<ResumePdfDocument model={JSON.parse(debounced) as ResumePdfModel} />)
  }, [debounced, update])

  return instance.url ? (
    <ResumePdfPages key={instance.url} url={instance.url} />
  ) : (
    <div role={instance.error ? 'alert' : 'status'} className="resume-preview-message flex-1">
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
