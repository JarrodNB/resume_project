/** A compact dropdown for picking several values from a short list, such as job board filters
 * or interview focus areas. The trigger summarizes the choices; the checkboxes open in a popover.
 * Callers render their own visible label and pass its id, so the trigger reads as "label + summary".
 */
import { ChevronDown } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function MultiSelect<Value extends string>({ id, labelId, emptyLabel, options, selected, onChange }: {
  id: string; labelId: string; emptyLabel: string
  options: readonly { value: Value; label: string }[]
  selected: Value[]; onChange: (values: Value[]) => void
}) {
  const chosen = options.filter((option) => selected.includes(option.value))
  const summary = chosen.length === 0 ? emptyLabel : chosen.length <= 2 ? chosen.map((option) => option.label).join(', ') : `${chosen.length} selected`
  return <Popover>
    <PopoverTrigger asChild><button type="button" id={id} className="multiselect-trigger" aria-labelledby={`${labelId} ${id}`}>
      <span>{summary}</span><ChevronDown size={16} aria-hidden />
    </button></PopoverTrigger>
    <PopoverContent align="start" collisionPadding={16} aria-labelledby={labelId} className="multiselect-options">
      {options.map((option) => <Label key={option.value}>
        {/* Keep the option order stable no matter which order they were picked in. */}
        <Checkbox checked={selected.includes(option.value)} onCheckedChange={(checked) => onChange(options.filter((item) => item.value === option.value ? checked === true : selected.includes(item.value)).map((item) => item.value))} />{option.label}
      </Label>)}
    </PopoverContent>
  </Popover>
}
