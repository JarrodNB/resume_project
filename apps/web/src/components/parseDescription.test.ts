/** Protect the plain-text syntax boundaries without relying on the renderer's markup. */
import { expect, it } from 'vitest'
import { parseDescription } from './parseDescription'

it('keeps paragraph and list transitions in the same block in source order', () => {
  expect(parseDescription('Duties:\n  First line\nSecond line\n- Build\n• Review\nThen report\n- Repeat')).toEqual([[
    { kind: 'label', text: 'Duties:' },
    { kind: 'paragraph', text: 'First line\nSecond line' },
    { kind: 'list', items: ['Build', 'Review'] },
    { kind: 'paragraph', text: 'Then report' },
    { kind: 'list', items: ['Repeat'] },
  ]])
})

it('ignores empty blocks and keeps bullet-prefixed labels as list items', () => {
  expect(parseDescription(' \n\n- Requirements:\n\n\t\n\n  Details  \n')).toEqual([
    [{ kind: 'list', items: ['Requirements:'] }],
    [{ kind: 'paragraph', text: 'Details' }],
  ])
  expect(parseDescription(' \n\n\t\n')).toEqual([])
})

it('recognizes labels only on the first line and within the length limit', () => {
  const label = `${'a'.repeat(79)}:`
  expect(parseDescription(`${label}\nDetails`)[0][0]).toEqual({ kind: 'label', text: label })
  expect(parseDescription(`${label}:\nDetails`)).toEqual([[
    { kind: 'paragraph', text: `${label}:\nDetails` },
  ]])
  expect(parseDescription('Intro\nRequirements:')).toEqual([[
    { kind: 'paragraph', text: 'Intro\nRequirements:' },
  ]])
})
