// @vitest-environment node
/** Read real generated PDFs to check text, links, ordering, and content spanning pages. */
import { expect, it, vi } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { generateResumePdf } from './resumeDownload'
import { buildResumePdfModel } from './resumePdfModel'
import { inspectPdfLayout, readPdfGeometry } from './pdfLayoutTestSupport'

vi.stubGlobal('localStorage', { clear() {} })

it('exports readable ordered content and clickable contact links while omitting empty sections', async () => {
  const model = buildResumePdfModel([
    { sectionType: 'contact', title: 'Contact', content: { full_name: 'Ada Lovelace', email: 'ada@example.com', links: [{ label: 'Portfolio', url: 'https://ada.example/' }] } },
    { sectionType: 'summary', title: 'Summary', content: { text: 'Building useful software.' } },
    { sectionType: 'skills', title: 'Empty skills', content: { items: [] } },
    { sectionType: 'experience', title: 'Experience', content: { items: [{ title: 'Engineer', company: 'Acme', start_date: '2020-01', is_current: true, location: 'London', description: 'Team leadership.', highlights: ['Shipped important features'] }] } },
    { sectionType: 'projects', title: 'Projects', content: { items: [{ name: 'Compiler', role: 'Maintainer', url: 'https://compiler.example', description: 'Fast compilation.' }] } },
    { sectionType: 'education', title: 'Education', content: { items: [{ institution: 'University', degree: 'BSc', field_of_study: 'Computing', description: 'Honors graduate.' }] } },
    { sectionType: 'certifications', title: 'Certifications', content: { items: [{ name: 'Cloud certificate', issuer: 'Cloud academy', credential_id: 'CERT-42', credential_url: 'https://cert.example', issued_date: '2024-01', expiry_date: '2027-01', description: 'Cloud architecture.' }] } },
    { sectionType: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: 'Languages' }] } },
  ])
  const blob = await generateResumePdf(model)
  expect(blob.type).toBe('application/pdf')
  const [geometry] = await readPdfGeometry(blob)
  for (const text of ['Ada Lovelace', 'ada@example.com', 'Portfolio']) {
    const line = geometry.lines.find((line) => line.text === text)!
    expect(line).toBeDefined()
    expect((line.left + line.right) / 2).toBeCloseTo(geometry.width / 2, 0)
  }
  expect(geometry.lines.find((line) => line.text === 'Building useful software.')!.left).toBeCloseTo(48, 0)
  const loading = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true })
  const pdf = await loading.promise
  try {
    const page = await pdf.getPage(1)
    const content = await page.getTextContent()
    const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ')
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('ada@example.com')
    expect(text.indexOf('SUMMARY')).toBeLessThan(text.indexOf('EXPERIENCE'))
    expect(text).toContain('Shipped important features')
    for (const value of ['Team leadership.', 'Acme', 'London', 'Present', 'Compiler', 'Maintainer', 'https://compiler.example', 'Fast compilation.', 'University', 'BSc, Computing', 'Honors graduate.', 'Cloud certificate', 'Cloud academy', 'CERT-42', 'https://cert.example', 'Issued', 'Expires', 'Cloud architecture.', 'Languages: Ruby']) expect(text).toContain(value)
    const headings = ['SUMMARY', 'EXPERIENCE', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS', 'SKILLS']
    for (let index = 1; index < headings.length; index++) expect(text.indexOf(headings[index - 1])).toBeLessThan(text.indexOf(headings[index]))
    expect(text).not.toContain('EMPTY SKILLS')
    expect(await page.getAnnotations()).toEqual(expect.arrayContaining([expect.objectContaining({ url: 'https://ada.example/' })]))
  } finally { await loading.destroy() }
})

it('flows a single long experience across pages without dropping text or drawing outside page margins', async () => {
  const bullets = Array.from({ length: 110 }, (_, index) => `Achievement ${index}: delivered reliable software for customers and teammates.`)
  const model = buildResumePdfModel([{ sectionType: 'experience', title: 'Experience', content: { items: [{ title: 'Engineer', company: 'Acme', highlights: bullets }] } }])
  const blob = await generateResumePdf(model)
  const loading = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true })
  const pdf = await loading.promise
  try {
    expect(pdf.numPages).toBeGreaterThan(1)
    const texts: string[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      expect(page.view).toEqual([0, 0, 612, 792])
      const content = await page.getTextContent()
      expect(content.items.some((item) => 'str' in item && item.str.includes('Achievement'))).toBe(true)
      for (const item of content.items) {
        if ('str' in item) {
          texts.push(item.str)
          if (item.str.trim()) {
            expect(item.transform[5]).toBeGreaterThanOrEqual(39)
            expect(item.transform[5]).toBeLessThanOrEqual(752)
          }
        }
      }
    }
    const text = texts.join(' ')
    for (let index = 0; index < bullets.length; index++) expect(text).toContain(`Achievement ${index}:`)
  } finally { await loading.destroy() }
})

it('leaves retained excluded summary text out of the actual PDF', async () => {
  const model = buildResumePdfModel([
    { sectionType: 'contact', title: 'Contact', content: { full_name: 'Ada' } },
    { sectionType: 'summary', title: 'Summary', content: { text: 'Retained private summary.' } },
  ], false)
  const blob = await generateResumePdf(model)
  const loading = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true })
  try {
    const pdf = await loading.promise
    const content = await (await pdf.getPage(1)).getTextContent()
    const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ')
    expect(text).toContain('Ada')
    expect(text).not.toContain('Retained private summary.')
    expect(text).not.toContain('SUMMARY')
  } finally { await loading.destroy() }
})

// Sweep near page boundaries so minPresenceAhead is exercised rather than merely
// checking a short document that could never strand a heading.
it('keeps section and wrapped entry headings with their details near page breaks', async () => {
  for (const count of [30, 32, 34, 36, 38, 40, 42]) {
    const model = buildResumePdfModel([
      { sectionType: 'contact', title: 'Contact', content: { full_name: 'Zoë García', links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] } },
      { sectionType: 'experience', title: 'Experience', content: { items: [{ title: 'Engineer', company: 'Acme', highlights: Array.from({ length: count }, (_, index) => `Delivered improvement ${index} for colleagues.`) }] } },
      { sectionType: 'projects', title: 'Projects', content: { items: [{ name: 'Distributed systems migration and infrastructure modernization for a very long international employer name spanning regional platforms and cross-functional service teams', role: 'Technical lead', description: 'Coordinated the migration with colleagues and documented the rollout.', highlights: ['Kept the deployment process understandable.'] }] } },
      { sectionType: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby' }, { name: 'Python' }] } },
    ])
    const blob = await generateResumePdf(model)
    const pages = await readPdfGeometry(blob)
    expect(pages.flatMap((page) => page.lines).some((line) => line.text.includes(model.blocks[1].entries[0].heading))).toBe(false)
    const findings = inspectPdfLayout(pages, [
      ...model.blocks.map((block) => ({ text: block.title.toUpperCase(), kind: 'section' as const })),
      ...model.blocks.flatMap((block) => block.entries.filter((entry) => entry.meta || entry.body || entry.bullets.length)
        .map((entry) => ({ text: entry.heading, kind: 'entry' as const }))),
    ])
    expect(findings.filter((finding) => finding.severity === 'error' || finding.kind === 'internal-gap' || finding.kind === 'early-ending'), `bullet count ${count}`).toEqual([])
    const exportedText = pages.flatMap((page) => page.lines).map((line) => line.text).join(' ')
    expect(exportedText).toContain('Zoë García')
    for (const block of model.blocks) {
      expect(exportedText).toContain(block.title.toUpperCase())
      for (const entry of block.entries) {
        expect(exportedText).toContain(entry.heading)
        if (entry.meta) expect(exportedText).toContain(entry.meta)
        if (entry.body) expect(exportedText).toContain(entry.body)
        for (const bullet of entry.bullets) expect(exportedText).toContain(bullet)
      }
    }
  }
})

it('accepts a sparse skills-only export without a thin-page warning', async () => {
  const model = buildResumePdfModel([{ sectionType: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby' }] } }])
  const pages = await readPdfGeometry(await generateResumePdf(model))
  expect(pages).toHaveLength(1)
  expect(inspectPdfLayout(pages, [{ text: 'SKILLS', kind: 'section' }])).toEqual([])
})
