// @vitest-environment node
/** Read real generated PDFs to check text, links, ordering, and content spanning pages. */
import { expect, it, vi } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { generateResumePdf } from './resumeDownload'

vi.stubGlobal('localStorage', { clear() {} })

it('renders Markdown with editable structure and safe PDF links across pages', async () => {
  const markdown = '# Ada Lovelace\n\n## Experience\nBuilt **reliable** and *useful* systems at [Acme](https://acme.example).\n\n' + Array.from({ length: 90 }, (_, index) => `- Delivered outcome ${index}`).join('\n')
  const blob = await generateResumePdf(markdown)
  const loading = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true })
  const document = await loading.promise
  try {
    expect(document.numPages).toBeGreaterThan(1)
    const text: string[] = []
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      expect(page.view).toEqual([0, 0, 612, 792])
      const content = await page.getTextContent()
      text.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
      for (const item of content.items) {
        if ('str' in item && item.str.trim()) {
          expect(item.transform[5]).toBeGreaterThanOrEqual(39)
          expect(item.transform[5]).toBeLessThanOrEqual(752)
        }
      }
    }
    for (let index = 0; index < 90; index++) expect(text.join(' ')).toContain(`Delivered outcome ${index}`)
    expect(text.join(' ').indexOf('Ada Lovelace')).toBeLessThan(text.join(' ').indexOf('Experience'))
    const firstPageContent = await (await document.getPage(1)).getTextContent()
    const fontFor = (part: string) => firstPageContent.items.find((item) => 'str' in item && item.str.includes(part))
    expect(fontFor('reliable')).toHaveProperty('fontName')
    expect(fontFor('reliable')).not.toHaveProperty('fontName', (fontFor('Built') as { fontName: string }).fontName)
    expect(fontFor('Ada Lovelace')).toHaveProperty('fontName', (fontFor('reliable') as { fontName: string }).fontName)
    expect(fontFor('Experience')).toHaveProperty('fontName', (fontFor('reliable') as { fontName: string }).fontName)
    expect(fontFor('useful')).not.toHaveProperty('fontName', (fontFor('Built') as { fontName: string }).fontName)
    expect((await (await document.getPage(1)).getAnnotations())).toEqual(expect.arrayContaining([expect.objectContaining({ url: 'https://acme.example/' })]))
  } finally { await loading.destroy() }
})

it('prints malformed and raw HTML as text without creating an unsafe PDF link', async () => {
  const blob = await generateResumePdf('# Ada\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert) **unclosed')
  const loading = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true })
  const document = await loading.promise
  try {
    const page = await document.getPage(1)
    const text = (await page.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ')
    expect(text).toContain('<script>alert(1)</script>')
    expect(text).toContain('**unclosed')
    expect(await page.getAnnotations()).toEqual([])
  } finally { await loading.destroy() }
})
