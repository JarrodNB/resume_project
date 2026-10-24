// @vitest-environment node
/** Inspect real Word output rather than mocking the document generator. */
import { expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { generateResumeDocx } from './resumeDocxDocument'
vi.stubGlobal('localStorage', { clear() {} })

it('writes Markdown as native headings, paragraphs, bullets, emphasis and links', async () => {
  const blob = await generateResumeDocx('# Ada Lovelace\n\nada_data_science@example.com\n\n## Experience\nBuilt **reliable** and *useful* tools at [Acme](https://acme.example).\n\n- Shipped software')
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const xml = strFromU8(zip['word/document.xml'])
  expect(xml).toContain('ada_data_science@example.com')
  expect(xml).toContain('Heading1')
  expect(xml).toContain('Heading2')
  expect(xml).toContain('<w:numPr>')
  expect(xml).toContain('w:b')
  expect(xml).toContain('w:i')
  expect(xml).toContain('<w:hyperlink')
  expect(strFromU8(zip['word/_rels/document.xml.rels'])).toContain('https://acme.example')
})

it('keeps raw HTML and malformed links as editable text without active relationships', async () => {
  const blob = await generateResumeDocx('# Ada\n\n<script>alert(1)</script> [unsafe](javascript:alert)')
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const xml = strFromU8(zip['word/document.xml'])
  expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(xml).toContain('[unsafe](javascript:alert)')
  expect(strFromU8(zip['word/_rels/document.xml.rels'])).not.toContain('javascript:')
})

it('preserves long Markdown documents and fixed page settings in editable Word output', async () => {
  const markdown = '# Ada Lovelace\n\n## Summary\nOverview & goals.\n\n## Experience\n### Engineer at Acme\n2024 – Present\n\n' + Array.from({ length: 180 }, (_, index) => `- Achievement ${index}: ${'Useful work. '.repeat(20)}`).join('\n') + '\n\n## Education\nUniversity – BSc Computing'
  const zip = unzipSync(new Uint8Array(await (await generateResumeDocx(markdown)).arrayBuffer()))
  const xml = strFromU8(zip['word/document.xml'])
  for (const value of ['Ada Lovelace', 'Overview &amp; goals.', 'Engineer at Acme', 'Present', 'University – BSc Computing']) expect(xml).toContain(value)
  for (let index = 0; index < 180; index++) expect(xml).toContain(`Achievement ${index}:`)
  expect(xml.match(/<w:numPr>/g)).toHaveLength(180)
  expect(xml).not.toContain('<w:keepLines')
  expect(xml).toContain('w:w="12240" w:h="15840"')
  expect(strFromU8(zip['word/numbering.xml'])).toContain('w:val="bullet"')
  const headings = [...xml.matchAll(/<w:pStyle w:val="Heading2"\/>.*?<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1])
  expect(headings).toEqual(['Summary', 'Experience', 'Education'])
})
