/** Chooses whether summary text appears in resume output without deleting that text. */
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'

export function SummaryInclusionControl({ checked, onChange, disabled = false, description = 'Summary text is kept when excluded from preview and downloads.' }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; description?: string }) {
  const id = useId()
  return (
    <div className="grid gap-1 text-sm">
      <label className="flex items-center gap-2" htmlFor={id}>
        <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} aria-describedby={`${id}-description`} />
        Include summary
      </label>
      <p id={`${id}-description`} className="text-muted-foreground">{description}</p>
    </div>
  )
}
