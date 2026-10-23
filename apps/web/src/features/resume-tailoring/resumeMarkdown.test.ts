/** Check the supported resume Markdown contract through its public parser. */
import { expect, it } from 'vitest'
import { parseResumeMarkdown } from './resumeMarkdown'

it('keeps headings, paragraphs, bullets, emphasis, and safe links in source order', () => {
  expect(parseResumeMarkdown('# Ada Lovelace\n\n## Experience\nBuilt **reliable** and *useful* tools at [Acme](https://acme.example).\n\n- Led a team\n- Shipped updates')).toEqual([
    { type: 'heading', level: 1, children: [{ text: 'Ada Lovelace' }] },
    { type: 'heading', level: 2, children: [{ text: 'Experience' }] },
    { type: 'paragraph', children: [{ text: 'Built ' }, { text: 'reliable', bold: true }, { text: ' and ' }, { text: 'useful', italic: true }, { text: ' tools at ' }, { text: 'Acme', href: 'https://acme.example' }, { text: '.' }] },
    { type: 'bullet', children: [{ text: 'Led a team' }] },
    { type: 'bullet', children: [{ text: 'Shipped updates' }] },
  ])
})

it('treats HTML, layout syntax, unsafe links, and malformed markup as inert text', () => {
  const blocks = parseResumeMarkdown('<script>alert(1)</script>\n\n[click](javascript:alert(1)) ![image](https://x.example/a.png)\n\n| A | B |\n---\n\n**unclosed')
  expect(JSON.stringify(blocks)).not.toContain('"href":"javascript:')
  expect(blocks.map((block) => block.children.map((child) => child.text).join('')).join(' ')).toContain('<script>alert(1)</script>')
  expect(blocks.at(-1)?.children).toEqual([{ text: '**unclosed' }])
})
