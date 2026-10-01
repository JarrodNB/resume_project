/**
 * Description: Generic list of editable entries (experiences, projects, educations), each in its
 * own bordered block with a remove button, plus an add button.
 * Index:
 *   - EditableList: renders `renderItem` for each entry and handles add/remove/replace
 */
import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EditableListProps<Item> {
  items: Item[]
  onChange: (items: Item[]) => void
  createItem: () => Item
  /** Short name of one entry, used in button labels (e.g. "experience"). */
  itemName: string
  /** Heading shown above an entry (e.g. "Engineer at Acme"). */
  describeItem: (item: Item) => string
  renderItem: (item: Item, onItemChange: (item: Item) => void) => ReactNode
}

/** Edits a list of entries; the caller renders each entry's fields. */
export function EditableList<Item>({ items, onChange, createItem, itemName, describeItem, renderItem }: EditableListProps<Item>) {
  const replaceAt = (index: number, item: Item) =>
    onChange(items.map((existing, position) => (position === index ? item : existing)))
  const removeAt = (index: number) => onChange(items.filter((_, position) => position !== index))

  return (
    <div className="grid gap-4">
      {items.length === 0 && <p className="text-sm text-muted-foreground">None found on your resume.</p>}
      {items.map((item, index) => (
        <div key={index} className="grid gap-4 rounded-lg border p-4">
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
