/** Show a plain-text job description as labels, paragraphs, and bullet lists.
 * Reads simple text conventions only: blank lines separate blocks, a short first line
 * ending in ":" labels its block, and lines starting with "- " or "• " are bullets.
 * Text is never parsed as HTML, so anything else is shown exactly as written.
 */
import { cn } from '@/lib/utils'
import { parseDescription } from './parseDescription'

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
