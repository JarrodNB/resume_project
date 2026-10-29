/** Show a plain-text job description as labels, paragraphs, and bullet lists.
 * Reads simple text conventions only: blank lines separate blocks, a short first line
 * ending in ":" labels its block, and lines starting with "- " or "• " are bullets.
 * Text is never parsed as HTML, so anything else is shown exactly as written.
 */
import { cn } from '@/lib/utils'

type DescriptionPart =
  | { kind: 'label'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }

const BULLET = /^[-•]\s+/
const LABEL_MAX_LENGTH = 80

/** Split description text into labelled blocks, paragraphs, and bullet lists. */
function parseDescription(text: string): DescriptionPart[][] {
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

interface FormattedDescriptionProps {
  text: string
  id?: string
  className?: string
}

export function FormattedDescription({ text, id, className }: FormattedDescriptionProps) {
  return (
    <div id={id} className={cn('grid gap-4', className)}>
      {parseDescription(text).map((parts, blockIndex) => (
        <div key={blockIndex} className="grid gap-1.5">
          {parts.map((part, partIndex) => {
            if (part.kind === 'label') return <p key={partIndex} className="font-semibold text-foreground">{part.text}</p>
            if (part.kind === 'list') {
              return (
                <ul key={partIndex} className="grid list-disc gap-1 pl-5">
                  {part.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                </ul>
              )
            }
            return <p key={partIndex} className="whitespace-pre-line">{part.text}</p>
          })}
        </div>
      ))}
    </div>
  )
}
