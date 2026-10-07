/**
 * Description: Add, edit, remove, and reorder the bullet points of a role.
 * Index:
 *   - HighlightEditor: one row per bullet with move and remove
 */
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/** Edits a role's bullets. Reordering uses up and down buttons. */
export function HighlightEditor({
  highlights,
  onChange,
  maxLength,
}: {
  highlights: string[]
  onChange: (highlights: string[]) => void
  maxLength?: number
}) {
  const replaceAt = (index: number, content: string) =>
    onChange(highlights.map((highlight, position) => (position === index ? content : highlight)))
  const removeAt = (index: number) => onChange(highlights.filter((_, position) => position !== index))
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= highlights.length) return
    const next = [...highlights]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Highlights</legend>
      {highlights.map((highlight, index) => (
        <div key={index} className="flex items-start gap-1">
          <Textarea aria-label={`Highlight ${index + 1}`} rows={2} maxLength={maxLength} value={highlight} onChange={(event) => replaceAt(index, event.target.value)} />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move highlight ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move highlight ${index + 1} down`}
            disabled={index === highlights.length - 1}
            onClick={() => move(index, 1)}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove highlight ${index + 1}`} onClick={() => removeAt(index)}>
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...highlights, ''])}>
        <Plus /> Add highlight
      </Button>
    </fieldset>
  )
}
