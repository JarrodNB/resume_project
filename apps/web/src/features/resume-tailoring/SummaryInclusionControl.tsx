/** Chooses whether summary text appears in resume output without deleting that text. */
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'

export function SummaryInclusionControl({ checked, onChange, disabled = false, description = 'Summary text is kept when excluded from preview and downloads.' }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; description?: string | null }) {
  const id = useId()
  return (
    <div className="summary-inclusion">
      <label htmlFor={id}>
        <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} aria-describedby={description ? `${id}-description` : undefined} />
        Include summary
      </label>
      {description && <p id={`${id}-description`}>{description}</p>}
    </div>
  )
}
