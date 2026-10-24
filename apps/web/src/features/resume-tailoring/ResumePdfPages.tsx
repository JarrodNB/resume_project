/** Draw the exported PDF inside the page without relying on a browser PDF plugin.
 * Pages fit their available width, keep their original proportions, and expose
 * their text to assistive technology. Loading and drawing stop when unmounted.
 */
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export function ResumePdfPages({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let canceled = false
    let loading: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined
    void import('pdfjs-dist').then((pdfjs) => {
      if (canceled) return
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      loading = pdfjs.getDocument({ url })
      return loading.promise
    }).then((pdf) => {
      if (!canceled && pdf) setDocument(pdf)
    }).catch(() => { if (!canceled) setFailed(true) })
    return () => { canceled = true; void loading?.destroy() }
  }, [url])

  return (
    <div ref={host} className="resume-pdf-pages" role="region" aria-label="Resume preview" tabIndex={0}>
      {failed ? <p role="alert" className="resume-preview-message">Couldn't draw the preview. Switch to Edit sections to review your content.</p>
        : !document ? <p role="status" className="resume-preview-message">Preparing preview…</p>
          : Array.from({ length: document.numPages }, (_, index) => (
            <PdfPage key={index} document={document} pageNumber={index + 1} width={width} />
          ))}
    </div>
  )
}

function PdfPage({ document, pageNumber, width }: { document: PDFDocumentProxy; pageNumber: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [text, setText] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!width) return
    let canceled = false
    let render: RenderTask | undefined
    void document.getPage(pageNumber).then(async (page) => {
      if (canceled || !canvas.current) return
      const density = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
      const element = canvas.current
      element.width = Math.ceil(viewport.width * density)
      element.height = Math.ceil(viewport.height * density)
      render = page.render({ canvas: element, viewport, transform: [density, 0, 0, density, 0, 0] })
      await render.promise
      const content = await page.getTextContent()
      if (!canceled) setText(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
    }).catch(() => { if (!canceled) setFailed(true) })
    return () => { canceled = true; render?.cancel() }
  }, [document, pageNumber, width])

  return (
    <figure className="resume-pdf-page" aria-label={`Page ${pageNumber}`}>
      {failed ? <p role="alert" className="resume-preview-message">Couldn't draw page {pageNumber}. Switch to Edit sections to review your content.</p> : <>
        <canvas ref={canvas} aria-hidden="true" />
        <p className="sr-only">{text}</p>
      </>}
      <figcaption>Page {pageNumber} of {document.numPages}</figcaption>
    </figure>
  )
}
