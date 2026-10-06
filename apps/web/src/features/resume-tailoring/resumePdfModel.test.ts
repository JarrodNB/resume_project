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
      content: { full_name: 'Ada Lovelace', email: 'ada@example.com', phone: null, location: 'London', links: ['https://ada.example'] },
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
  expect(model.links).toBe('https://ada.example')
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
  expect(buildResumePdfModel([])).toEqual({ name: '', contactLine: '', links: '', blocks: [] })
})
