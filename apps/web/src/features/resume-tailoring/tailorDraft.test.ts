/** Checks that tailored section saves keep edits and exclude browser-only drag keys. */
import { expect, it } from 'vitest'
import { contentFromSectionDraft, sectionDraftFromContent } from './tailorDraft'

it('saves edited experience highlights as plain text without draft keys', () => {
  const draft = sectionDraftFromContent('experience', {
    items: [{ title: 'Engineer', highlights: ['Built an API', null, 42] }],
  })
  if (draft.kind !== 'experience') throw new Error('Expected experience draft')
  expect(draft.items[0].key).toBeTruthy()
  expect(draft.items[0].highlights[0].key).toBeTruthy()
  draft.items[0].highlights[0].text = 'Built a tested API'

  const saved = contentFromSectionDraft(draft)
  expect(saved).toMatchObject({ items: [{ title: 'Engineer', highlights: ['Built a tested API'] }] })
  expect(JSON.stringify(saved)).not.toContain('"key":')
})

it.each(['projects', 'education', 'certifications', 'skills'] as const)(
  'removes editing keys when saving %s entries', (sectionType) => {
    const draft = sectionDraftFromContent(sectionType, { items: [{}] })
    if (!('items' in draft)) throw new Error('Expected entry draft')
    expect(draft.items[0].key).toBeTruthy()
    expect(JSON.stringify(contentFromSectionDraft(draft))).not.toContain('"key":')
  },
)
