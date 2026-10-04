/**
 * Description: Generic list of editable entries (experiences, projects, educations), each in its
 * own tinted block with a remove button, plus an add button.
 * Index:
 *   - EditableList: renders `renderItem` for each entry and handles add/remove/replace
 */
import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { SECTION_TONES, type SectionTone } from '@/components/sectionTones'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EditableListProps<Item extends { key: string }> {
  items: Item[]
  onChange: (items: Item[]) => void
  createItem: () => Item
  /** Short name of one entry, used in button labels (e.g. "experience"). */
  itemName: string
  tone: SectionTone
  /** Heading shown above an entry (e.g. "Engineer at Acme"). */
  describeItem: (item: Item) => string
  renderItem: (item: Item, onItemChange: (item: Item) => void) => ReactNode
}

/** Edits a list of entries; the caller renders each entry's fields. */
export function EditableList<Item extends { key: string }>({
  items,
  onChange,
  createItem,
  itemName,
  tone,
  describeItem,
  renderItem,
}: EditableListProps<Item>) {
  const replaceAt = (index: number, item: Item) =>
    onChange(items.map((existing, position) => (position === index ? item : existing)))
  const removeAt = (index: number) => onChange(items.filter((_, position) => position !== index))

  return (
    <div className="grid gap-4">
      {items.length === 0 && <p className="text-sm text-muted-foreground">None found on your resume.</p>}
      {items.map((item, index) => (
        <div key={item.key} className={cn('grid gap-4 rounded-lg border p-4', SECTION_TONES[tone].entry)}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{describeItem(item) || `New ${itemName}`}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${itemName} ${index + 1}`}
              onClick={() => removeAt(index)}
            >
              <Trash2 /> Remove
            </Button>
          </div>
          {renderItem(item, (updated) => replaceAt(index, updated))}
        </div>
      ))}
      <Button type="button" variant="outline" className="justify-self-start" onClick={() => onChange([...items, createItem()])}>
        <Plus /> Add {itemName}
      </Button>
    </div>
  )
}
