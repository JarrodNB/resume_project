// @vitest-environment node
/** Read real generated PDFs to check text, links, ordering, and content spanning pages. */
import { expect, it, vi } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { generateResumePdf } from './resumeDownload'
import { buildResumePdfModel } from './resumePdfModel'

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
