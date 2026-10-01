/**
 * Description: Editable list of strings (experience highlights, contact links).
 * Index:
 *   - StringListField: one input per entry, with remove buttons and an add button
 */
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface StringListFieldProps {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  addLabel: string
  multiline?: boolean
}

/** Lets the user edit, remove, and add entries in a list of strings. */
export function StringListField({ label, values, onChange, addLabel, multiline = false }: StringListFieldProps) {
  const replaceAt = (index: number, value: string) =>
    onChange(values.map((existing, position) => (position === index ? value : existing)))
  const removeAt = (index: number) => onChange(values.filter((_, position) => position !== index))

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {values.map((value, index) => (
        <div key={index} className="flex items-start gap-2">
          {multiline ? (
            <Textarea
              aria-label={`${label} ${index + 1}`}
              rows={2}
              value={value}
              onChange={(event) => replaceAt(index, event.target.value)}
            />
          ) : (
            <Input aria-label={`${label} ${index + 1}`} value={value} onChange={(event) => replaceAt(index, event.target.value)} />
          )}
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label} ${index + 1}`} onClick={() => removeAt(index)}>
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...values, ''])}>
        <Plus /> {addLabel}
      </Button>
    </fieldset>
  )
}
