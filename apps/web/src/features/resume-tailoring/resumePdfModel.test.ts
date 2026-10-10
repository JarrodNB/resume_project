/**
 * Description: The PDF model keeps contact as the header and drops empty sections.
 */
import { expect, it } from 'vitest'
import { buildResumePdfModel } from './resumePdfModel'

it('builds a header and the sections that have something to print', () => {
  const model = buildResumePdfModel([
    {
      sectionType: 'contact',
      title: 'Contact',
      content: { full_name: 'Ada Lovelace', email: 'ada@example.com', phone: null, location: 'London', links: [{ label: 'Website', url: 'https://ada.example' }] },
    },
    { sectionType: 'summary', title: 'Summary', content: { text: '  ' } },
    {
      sectionType: 'experience',
      title: 'Experience',
      content: {
        items: [
          {
            title: 'Engineer',
            company: 'Acme',
            location: 'Remote',
            start_date: '2021-03',
            end_date: null,
            is_current: true,
            highlights: ['Shipped it', ''],
          },
        ],
      },
    },
    {
      sectionType: 'skills',
      title: 'Skills',
      content: {
        items: [
          { name: 'Ruby', category: 'Languages' },
          { name: 'Python', category: 'Languages' },
          { name: 'Docker', category: null },
        ],
      },
    },
  ])

  expect(model.name).toBe('Ada Lovelace')
  expect(model.contactLine).toBe('ada@example.com · London')
  expect(model.links).toEqual([{ label: 'Website', url: 'https://ada.example' }])
  expect(model.blocks.map((block) => block.title)).toEqual(['Experience', 'Skills'])
  expect(model.blocks[0]?.entries[0]).toMatchObject({
    heading: 'Engineer',
    meta: 'Acme · Remote',
    dates: 'Mar 2021 – Present',
    bullets: ['Shipped it'],
  })
  expect(model.blocks[1]?.text).toBe('Languages: Ruby, Python\nDocker')
})

it('returns an empty document when there is nothing to print', () => {
  expect(buildResumePdfModel([])).toEqual({ name: '', contactLine: '', links: [], blocks: [] })
})

it('prints certifications separately with explicit issue and expiry dates', () => {
  const model = buildResumePdfModel([
    { sectionType: 'education', title: 'Education', content: { items: [{ institution: 'University' }] } },
    { sectionType: 'certifications', title: 'Certifications', content: { items: [
      { name: 'Cloud Architect', issuer: 'Cloud Co', issued_date: '2024', expiry_date: '2027-06', credential_id: 'ABC', credential_url: 'https://example.com/ABC', description: 'Professional credential' },
    ] } },
  ])
  expect(model.blocks.map((block) => block.title)).toEqual(['Education', 'Certifications'])
  expect(model.blocks[1]?.entries[0]).toEqual({ heading: 'Cloud Architect', meta: 'Cloud Co · ABC · https://example.com/ABC', dates: 'Issued 2024 · Expires Jun 2027', body: 'Professional credential', bullets: [] })
})

it('retains exact certification expiry days in the PDF', () => {
  const model = buildResumePdfModel([{ sectionType: 'certifications', title: 'Certifications', content: {
    items: [{ name: 'Cloud Architect', issued_date: '2024-06', expiry_date: '2026-10-31' }],
  } }])
  expect(model.blocks[0]?.entries[0]?.dates).toBe('Issued Jun 2024 · Expires Oct 31, 2026')
})
