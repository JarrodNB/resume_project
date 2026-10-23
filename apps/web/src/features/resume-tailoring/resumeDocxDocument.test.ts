// @vitest-environment node
/** Inspect real Word output rather than mocking the document generator. */
import { expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { generateResumeDocx } from './resumeDocxDocument'
vi.stubGlobal('localStorage', { clear() {} })

it('writes editable headings, ordered text, native bullets and hyperlink relationships', async () => {
  const blob = await generateResumeDocx({ name: 'Ada Lovelace', contactLine: 'ada@example.com', links: [{ label: 'Portfolio', url: 'https://example.com' }], blocks: [{ title: 'Summary', text: 'Build useful things.', entries: [] }, { title: 'Experience', text: '', entries: [{ heading: 'Engineer', dates: '2024 – Present', meta: 'Acme', body: 'Built systems.', bullets: ['Reduced latency.'] }] }] })
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const xml = strFromU8(zip['word/document.xml'])
  expect(xml).toContain('Heading1')
  expect(xml).toContain('Heading2')
  expect(xml).toContain('<w:numPr>')
  expect(xml).toContain('<w:hyperlink')
  expect(strFromU8(zip['word/_rels/document.xml.rels'])).toContain('https://example.com')
  const texts = [...xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ')
  expect(texts).toMatch(/Ada Lovelace.*ada@example.com.*Portfolio.*Summary.*Build useful things.*Experience.*Engineer.*2024.*Acme.*Built systems.*Reduced latency/s)
})

it('uses shared section mapping, omits empty sections and preserves long document content', async () => {
  const { buildResumePdfModel } = await import('./resumePdfModel')
  const model = buildResumePdfModel([
    { sectionType: 'summary', title: 'Summary', content: { text: 'Overview & goals.' } },
    { sectionType: 'skills', title: 'Empty skills', content: { items: [] } },
    { sectionType: 'experience', title: 'Experience', content: { items: [{ title: 'Engineer', company: 'Acme', start_date: '2020-01', is_current: true, description: 'Team leadership.', highlights: Array.from({ length: 180 }, (_, i) => `Achievement ${i}: ${'Useful work. '.repeat(20)}`) }] } },
    { sectionType: 'projects', title: 'Projects', content: { items: [{ name: 'Compiler', role: 'Maintainer', url: 'https://compiler.example', description: 'Fast compilation.' }] } },
    { sectionType: 'education', title: 'Education', content: { items: [{ institution: 'University', degree: 'BSc', field_of_study: 'Computing', description: 'Honors.' }] } },
    { sectionType: 'certifications', title: 'Certifications', content: { items: [{ name: 'Certificate', issuer: 'Academy', credential_id: 'CERT-42', credential_url: 'https://cert.example', issued_date: '2024-01', expiry_date: '2027-01', description: 'Cloud architecture.' }] } },
    { sectionType: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: 'Languages' }, { name: 'Rails', category: 'Frameworks' }] } },
  ])
  const zip = unzipSync(new Uint8Array(await (await generateResumeDocx(model)).arrayBuffer()))
  const xml = strFromU8(zip['word/document.xml'])
  expect(xml).not.toContain('Empty skills')
  for (const value of ['Overview &amp; goals.', 'Engineer', 'Acme', 'Present', 'Team leadership.', 'Achievement 0:', 'Achievement 179:', 'Compiler', 'Maintainer', 'https://compiler.example', 'Fast compilation.', 'University', 'BSc, Computing', 'Honors.', 'Certificate', 'Academy', 'CERT-42', 'https://cert.example', 'Issued', 'Expires', 'Cloud architecture.', 'Languages: Ruby', 'Frameworks: Rails']) expect(xml).toContain(value)
  const headings = [...xml.matchAll(/<w:pStyle w:val="Heading1"\/>.*?<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1])
  expect(headings).toEqual(['Summary', 'Experience', 'Projects', 'Education', 'Certifications', 'Skills'])
  expect(xml.match(/<w:numPr>/g)).toHaveLength(180)
  expect(xml).not.toContain('<w:keepLines')
  expect(xml).toContain('w:w="12240" w:h="15840"')
  expect(strFromU8(zip['word/numbering.xml'])).toContain('w:val="bullet"')
})
