// @vitest-environment node
/// <reference types="node" />
/** Generate synthetic exports with the actual document renderer.
 * Optional output feeds the Python inspector test across the container boundary. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'
import { renderToBuffer } from '@react-pdf/renderer'
import { expect, it } from 'vitest'
import { ResumePdfDocument } from './ResumePdfDocument'
import { buildResumePdfModel, type ResumePdfSourceSection } from './resumePdfModel'

const basic: ResumePdfSourceSection[] = [
  { sectionType: 'contact', title: 'Contact', content: { full_name: 'Alex Example', email: 'alex@example.test', phone: '+1 555 0100', location: 'Singapore', links: [{label: 'Portfolio', url: 'https://example.test'}] } },
  { sectionType: 'summary', title: 'Professional summary', content: { text: 'Engineer building reliable tools and clear customer experiences.' } },
  { sectionType: 'experience', title: 'Professional experience', content: { items: [{title: 'Software engineer', company: 'Example Labs', location: 'Remote', start_date: '2023-01', end_date: null, is_current: true, description: 'Built internal tools for support teams.', highlights: ['Reduced repeated manual work through tested automation.', 'Reviewed changes with product and operations teams.']}] } },
  { sectionType: 'projects', title: 'Projects', content: {items: [{name: 'Search toolkit', role: 'Maintainer', url: 'https://example.test/search', start_date: '2022-03', end_date: '2023-04', description: 'A practical search library.'}]} },
  { sectionType: 'education', title: 'Education', content: {items: [{institution: 'Example University', degree: 'BSc', field_of_study: 'Computer Science', start_date: '2018', end_date: '2022', description: 'Studied distributed systems.'}]} },
  { sectionType: 'certifications', title: 'Certifications', content: {items: [{name: 'Cloud Certificate', issuer: 'Example Institute', issued_date: '2024-02-03', expiry_date: '2027-02', credential_id: 'EX123', credential_url: 'https://example.test/credential', description: 'Cloud engineering fundamentals.'}]} },
  { sectionType: 'skills', title: 'Skills', content: {items: [{name: 'TypeScript', category: 'Languages'}, {name: 'Python', category: 'Languages'}, {name: 'Docker', category: 'Tools'}]} },
]
const long: ResumePdfSourceSection[] = [
  basic[0],
  basic[1],
  { sectionType: 'experience', title: 'Experience', content: {items: Array.from({length: 22}, (_, index) => ({
    title: 'Engineer ' + index, company: 'Company ' + index, start_date: '2020-01', end_date: '2021-12', location: 'Remote',
    description: 'Delivered reliable services with clear ownership and careful review for team ' + index + '.',
    highlights: ['Built a synthetic example service ' + index + ' with tests and documentation.', 'Collaborated across teams to improve customer support workflows.'],
  }))} },
  basic[4], basic[5], basic[6],
]

for (const [name, sections] of [['complete', basic], ['multipage', long]] as const) {
  it('renders the production ' + name + ' PDF for ATS inspection', async () => {
    const bytes = await renderToBuffer(<ResumePdfDocument model={buildResumePdfModel([...sections])} />)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)
    if (env.ATS_EXPORT_FIXTURES) {
      mkdirSync(env.ATS_EXPORT_FIXTURES, {recursive: true})
      writeFileSync(join(env.ATS_EXPORT_FIXTURES, name + '.pdf'), bytes)
      writeFileSync(join(env.ATS_EXPORT_FIXTURES, name + '.json'), JSON.stringify(sections.map((section, position) => ({
        id: 'section-' + position, section_type: section.sectionType, title: section.title, position, content: section.content,
      }))))
    }
  })
}
