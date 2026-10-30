// @vitest-environment node
/** Exercise the geometry checker with deliberately bad layouts and exact boundaries. */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { Document, Page, Text, pdf } from '@react-pdf/renderer'
import { groupPdfLines, inspectPdfLayout, PDF_LAYOUT_LIMITS, readPdfGeometry } from './pdfLayoutTestSupport'
import type { PdfLine, PdfPageGeometry } from './pdfLayoutTestSupport'

vi.stubGlobal('localStorage', { clear() {} })

const line = (text: string, top: number, left = 48): PdfLine => ({ text, top, bottom: top + 10, left, right: left + 100 })
const page = (...lines: PdfLine[]): PdfPageGeometry => ({ width: 612, height: 792, lines })

describe('exported PDF layout diagnostics', () => {
  it('groups mixed font/link runs by baseline and sorts them left to right', () => {
    expect(groupPdfLines([line('link', 40.8, 90), line('Name', 40), line('Body', 54)]))
      .toEqual([{ text: 'Name link', top: 40, bottom: 50.8, left: 48, right: 190 }, line('Body', 54)])
  })

  it.each(['section', 'entry'] as const)('finds a stranded %s heading, including wrapped labels with dates', (kind) => {
    const pages = [page(line('Earlier content', 40), line('Long engineering 2020–2024', 710), line('heading', 724)), page(line('First detail', 40))]
    expect(inspectPdfLayout(pages, [{ text: 'Long engineering heading', kind }]))
      .toContainEqual(expect.objectContaining({ page: 1, kind: 'detached-heading', severity: 'error' }))
    expect(inspectPdfLayout([page(...pages[0].lines, line('First detail', 738))], [{ text: 'Long engineering heading', kind }]))
      .not.toContainEqual(expect.objectContaining({ kind: 'detached-heading' }))
  })

  it('flags a blank inserted page and does not confuse missing extraction with success', async () => {
    expect(inspectPdfLayout([page(line('Body', 40)), page(), page(line('More', 40))]))
      .toContainEqual(expect.objectContaining({ page: 2, kind: 'empty-page', severity: 'error' }))
    await expect(readPdfGeometry(new Blob(['not a PDF']))).rejects.toThrow()
  })

  it('detects a detached heading in a deliberately broken actual PDF', async () => {
    const document = createElement(Document, null,
      createElement(Page, { size: 'LETTER' }, createElement(Text, { style: { position: 'absolute', top: 720, left: 48, fontSize: 11 } }, 'PROJECTS')),
      createElement(Page, { size: 'LETTER' }, createElement(Text, { style: { top: 40, left: 48, fontSize: 10 } }, 'The first project detail')))
    const pages = await readPdfGeometry(await pdf(document).toBlob())
    expect(inspectPdfLayout(pages, [{ text: 'PROJECTS', kind: 'section' }]))
      .toContainEqual(expect.objectContaining({ page: 1, kind: 'detached-heading', severity: 'error' }))
  })

  it('rejects a readable PDF without a text layer instead of reporting a clean layout', async () => {
    const document = createElement(Document, null, createElement(Page, { size: 'LETTER' }))
    await expect(readPdfGeometry(await pdf(document).toBlob())).rejects.toThrow('no extractable text')
  })

  it('only reports internal gaps above the calibrated limit', () => {
    const gap = PDF_LAYOUT_LIMITS.internalGap
    expect(inspectPdfLayout([page(line('Before', 40), line('After', 50 + gap))])).toEqual([])
    expect(inspectPdfLayout([page(line('Before', 40), line('After', 50 + gap + 0.1))]))
      .toEqual([expect.objectContaining({ kind: 'internal-gap', severity: 'review' })])
  })

  it('reports early endings only on non-final pages and leaves sparse one-page resumes alone', () => {
    const boundary = 40 + (792 - 80) * (1 - PDF_LAYOUT_LIMITS.nonFinalUnusedFraction)
    expect(inspectPdfLayout([page(line('Body', boundary - 10)), page(line('Last', 400))])).toEqual([])
    expect(inspectPdfLayout([page(line('Body', boundary - 10.1)), page(line('Last', 400))]))
      .toEqual([expect.objectContaining({ page: 1, kind: 'early-ending', severity: 'review' })])
    expect(inspectPdfLayout([page(line('Skills: Ruby', 40))])).toEqual([])
  })

  it('treats thin final pages as a review signal with an exact boundary', () => {
    const boundary = 40 + (792 - 80) * PDF_LAYOUT_LIMITS.finalUsedFraction
    expect(inspectPdfLayout([page(line('Body', 730)), page(line('Last', boundary - 10))])).toEqual([])
    expect(inspectPdfLayout([page(line('Body', 730)), page(line('Last', boundary - 10.1))]))
      .toEqual([expect.objectContaining({ page: 2, kind: 'thin-final-page', severity: 'review' })])
  })
})
