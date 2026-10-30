/** A compact dropdown for picking several job board filter values, such as experience levels.
 * The trigger reads like the other filter selects and summarizes the choices; the list of
 * checkboxes opens in a popover. Choosing nothing means "include all".
 */
import { ChevronDown } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function JobBoardMultiSelect<Value extends string>({ id, label, emptyLabel, options, selected, onChange }: {
  id: string; label: string; emptyLabel: string
  options: readonly { value: Value; label: string }[]
  selected: Value[]; onChange: (values: Value[]) => void
}) {
  const chosen = options.filter((option) => selected.includes(option.value))
  const summary = chosen.length === 0 ? emptyLabel : chosen.length <= 2 ? chosen.map((option) => option.label).join(', ') : `${chosen.length} selected`
  return <div>
    <Label id={`${id}-label`} htmlFor={id}>{label}</Label>
    <Popover>
      <PopoverTrigger asChild><button type="button" id={id} className="board-multiselect-trigger" aria-labelledby={`${id}-label ${id}`}>
        <span>{summary}</span><ChevronDown size={16} aria-hidden />
      </button></PopoverTrigger>
      <PopoverContent align="start" collisionPadding={16} aria-labelledby={`${id}-label`} className="board-multiselect-options">
        {options.map((option) => <Label key={option.value}>
          {/* Keep the option order stable no matter which order they were picked in. */}
          <Checkbox checked={selected.includes(option.value)} onCheckedChange={(checked) => onChange(options.filter((item) => item.value === option.value ? checked === true : selected.includes(item.value)).map((item) => item.value))} />{option.label}
        </Label>)}
      </PopoverContent>
    </Popover>
  </div>
}
