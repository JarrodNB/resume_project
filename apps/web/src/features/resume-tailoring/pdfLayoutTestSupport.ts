/** Inspect actual exported PDF geometry in Node tests, without changing browser exports.
 * Coordinates are points from the top-left. Checks target this Letter renderer;
 * whitespace findings are review signals, not ATS compatibility or quality scores.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PdfLine { text: string; left: number; right: number; top: number; bottom: number }
export interface PdfPageGeometry { width: number; height: number; lines: PdfLine[] }
export interface PdfHeading { text: string; kind: 'section' | 'entry' }
export interface PdfLayoutFinding {
  page: number
  kind: 'empty-page' | 'detached-heading' | 'internal-gap' | 'early-ending' | 'thin-final-page'
  severity: 'error' | 'review'
  detail: string
}

// The renderer uses 40pt vertical and 48pt horizontal margins. A 72pt blank
// region is far larger than normal section spacing; six body lines are ~81pt.
export const PDF_LAYOUT_LIMITS = {
  verticalMargin: 40,
  sameBaselineTolerance: 2,
  internalGap: 72,
  nonFinalUnusedFraction: 0.25,
  finalUsedFraction: 0.35,
} as const

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

/** Decode every page; extraction errors must fail tests rather than look clean. */
export async function readPdfGeometry(blob: Blob): Promise<PdfPageGeometry[]> {
  const loading = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true })
  try {
    const pdf = await loading.promise
    const pages: PdfPageGeometry[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const runs: PdfLine[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const [left, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
        const run = { text: item.str, left, right: left + item.width, top: baseline - item.height, bottom: baseline }
        if (![run.left, run.right, run.top, run.bottom].every(Number.isFinite) || item.height <= 0) {
          throw new Error(`Unusable PDF text geometry on page ${number}`)
        }
        runs.push(run)
      }
      pages.push({ width: viewport.width, height: viewport.height, lines: groupPdfLines(runs) })
    }
    if (!pages.some((page) => page.lines.length)) throw new Error('PDF contains no extractable text')
    return pages
  } finally { await loading.destroy() }
}

/** Join adjacent text runs on a baseline (bold text, links and dates can split runs). */
export function groupPdfLines(runs: readonly PdfLine[]): PdfLine[] {
  const groups: PdfLine[][] = []
  for (const run of [...runs].sort((a, b) => a.bottom - b.bottom || a.left - b.left)) {
    const group = groups.at(-1)
    if (group && Math.abs(group[0].bottom - run.bottom) <= PDF_LAYOUT_LIMITS.sameBaselineTolerance) group.push(run)
    else groups.push([run])
  }
  return groups.map((group) => {
    const ordered = group.sort((a, b) => a.left - b.left)
    return {
      text: normalize(ordered.map((run) => run.text).join(' ')),
      left: Math.min(...group.map((run) => run.left)), right: Math.max(...group.map((run) => run.right)),
      top: Math.min(...group.map((run) => run.top)), bottom: Math.max(...group.map((run) => run.bottom)),
    }
  })
}

/** Match known fixture labels, including wrapped headings and right-aligned dates.
 * Remaining text on a matched line may be a date; continuation consumes the next
 * prefix. No font-size guesses or assumptions about particular occupations.
 */
function headingEnd(lines: readonly PdfLine[], start: number, heading: string): number | null {
  let remaining = normalize(heading)
  for (let index = start; index < lines.length; index++) {
    const text = normalize(lines[index].text)
    if (text === remaining || text.startsWith(`${remaining} `)) return index
    const words = remaining.split(' ')
    let consumed = 0
    for (let count = 1; count < words.length; count++) {
      const prefix = words.slice(0, count).join(' ')
      if (text === prefix || text.startsWith(`${prefix} `)) consumed = count
    }
    if (!consumed) return null
    remaining = words.slice(consumed).join(' ')
  }
  return null
}

/** Analyze readable geometry. Only unexpected blank pages and stranded headings
 * are errors; sparse resumes and large gaps need human review, not export blocking.
 * Supply only headings that actually have following content in the fixture.
 */
export function inspectPdfLayout(pages: readonly PdfPageGeometry[], headings: readonly PdfHeading[] = []): PdfLayoutFinding[] {
  const findings: PdfLayoutFinding[] = []
  const add = (page: number, kind: PdfLayoutFinding['kind'], severity: PdfLayoutFinding['severity'], detail: string) => {
    findings.push({ page, kind, severity, detail })
  }
  pages.forEach((page, pageIndex) => {
    const number = pageIndex + 1
    const lines = page.lines
    if (!lines.length) { add(number, 'empty-page', 'error', 'No text on this page'); return }
    for (let index = 1; index < lines.length; index++) {
      const gap = lines[index].top - lines[index - 1].bottom
      if (gap > PDF_LAYOUT_LIMITS.internalGap) add(number, 'internal-gap', 'review', `${gap.toFixed(1)}pt before “${lines[index].text}”`)
    }
    const usableHeight = page.height - 2 * PDF_LAYOUT_LIMITS.verticalMargin
    const usedHeight = lines.at(-1)!.bottom - PDF_LAYOUT_LIMITS.verticalMargin
    if (pageIndex < pages.length - 1 && usableHeight - usedHeight > usableHeight * PDF_LAYOUT_LIMITS.nonFinalUnusedFraction) {
      add(number, 'early-ending', 'review', 'Non-final page leaves over a quarter of its body unused')
    }
    if (pages.length > 1 && pageIndex === pages.length - 1 && usedHeight < usableHeight * PDF_LAYOUT_LIMITS.finalUsedFraction) {
      add(number, 'thin-final-page', 'review', 'Final page uses less than 35% of its body')
    }
    for (const heading of headings) {
      for (let index = 0; index < lines.length; index++) {
        const end = headingEnd(lines, index, heading.text)
        if (end !== null && end === lines.length - 1) {
          add(number, 'detached-heading', 'error', `${heading.kind} heading “${heading.text}” has no following text on this page`)
        }
      }
    }
  })
  return findings
}
