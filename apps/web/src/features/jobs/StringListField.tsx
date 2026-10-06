/**
 * Description: Add, edit, remove, and reorder a list of strings on the job form.
 * Index:
 *   - StringListField: one row per item with move and remove
 */
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface StringListFieldProps {
  legend: string
  addLabel: string
  itemLabel: string
  items: string[]
  onChange: (items: string[]) => void
}

/** Edits one list. Reordering uses up and down buttons. */
export function StringListField({ legend, addLabel, itemLabel, items, onChange }: StringListFieldProps) {
  const replaceAt = (index: number, content: string) => onChange(items.map((item, position) => (position === index ? content : item)))
  const removeAt = (index: number) => onChange(items.filter((_, position) => position !== index))
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-1">
          <Textarea aria-label={`${itemLabel} ${index + 1}`} rows={2} value={item} onChange={(event) => replaceAt(index, event.target.value)} />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${itemLabel} ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${itemLabel} ${index + 1} down`}
            disabled={index === items.length - 1}
            onClick={() => move(index, 1)}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${itemLabel} ${index + 1}`} onClick={() => removeAt(index)}>
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...items, ''])}>
        <Plus /> {addLabel}
      </Button>
    </fieldset>
  )
}
