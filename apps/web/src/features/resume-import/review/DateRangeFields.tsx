/**
 * Description: Start/end inputs for partial dates ("YYYY-MM" or "YYYY"), as the parser returns them.
 * Index:
 *   - DateRangeFields: two side-by-side date fields; the end field can be disabled (current role)
 */
import { TextField } from './TextField'

interface DateRangeFieldsProps {
  startDate: string | null
  endDate: string | null
  onChange: (dates: { start_date: string | null; end_date: string | null }) => void
  endDisabled?: boolean
}

/** Edits a start/end pair of partial dates. */
export function DateRangeFields({ startDate, endDate, onChange, endDisabled = false }: DateRangeFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <TextField
        label="Start"
        placeholder="YYYY-MM"
        value={startDate}
        onChange={(value) => onChange({ start_date: value, end_date: endDate })}
      />
      <TextField
        label="End"
        placeholder={endDisabled ? 'Present' : 'YYYY-MM'}
        value={endDisabled ? null : endDate}
        disabled={endDisabled}
        onChange={(value) => onChange({ start_date: startDate, end_date: value })}
      />
    </div>
  )
}
