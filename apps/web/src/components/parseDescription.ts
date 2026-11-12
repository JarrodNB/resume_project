/** Read the simple plain-text conventions used by job descriptions.
 * Blank lines split blocks; short first lines ending in a colon label them.
 * Bullets become lists, while all content remains text for the renderer to escape.
 */
type DescriptionPart =
  | { kind: 'label'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }

const BULLET = /^[-•]\s+/
const LABEL_MAX_LENGTH = 80

/** Split description text into labelled blocks, paragraphs, and bullet lists. */
export function parseDescription(text: string): DescriptionPart[][] {
  return text
    .split(/\n[ \t]*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const parts: DescriptionPart[] = []
      const [first] = lines
      const labelled = first.endsWith(':') && first.length <= LABEL_MAX_LENGTH && !BULLET.test(first)
      if (labelled) parts.push({ kind: 'label', text: first })
      for (const line of labelled ? lines.slice(1) : lines) {
        const last = parts.at(-1)
        if (BULLET.test(line)) {
          const item = line.replace(BULLET, '')
          if (last?.kind === 'list') last.items.push(item)
          else parts.push({ kind: 'list', items: [item] })
        } else if (last?.kind === 'paragraph') {
          last.text += `\n${line}`
        } else {
          parts.push({ kind: 'paragraph', text: line })
        }
      }
      return parts
    })
}

