/** Edits a certification date at the precision the user actually knows.
 * Native month and date pickers match the other library forms. Year-only values stay
 * year-only; choosing a more precise format clears the field instead of inventing dates.
 */
import { useId, useState, type Ref } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Precision = 'year' | 'month' | 'day'

/** Lets the user choose a year, month, or complete date without silently filling missing parts. */
export function CertificationDateField({ label, value, onChange, error, inputRef }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; inputRef?: Ref<HTMLInputElement>
}) {
  const id = useId()
  const [precision, setPrecision] = useState<Precision>(value.length === 4 ? 'year' : value.length === 7 ? 'month' : 'day')
  const hintId = `${id}-hint`

  function changePrecision(next: Precision) {
    const length = next === 'year' ? 4 : next === 'month' ? 7 : 10
    onChange(value.length > length ? value.slice(0, length) : value.length < length ? '' : value)
    setPrecision(next)
  }

  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label} ({precision === 'year' ? 'YYYY' : precision === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'})</Label>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label={`Precision for ${label}`}
          value={precision}
          onChange={event => changePrecision(event.target.value as Precision)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="year">Year</option>
          <option value="month">Month and year</option>
          <option value="day">Full date</option>
        </select>
        <Input
          id={id}
          ref={inputRef}
          className="min-w-0 flex-1 basis-36"
          type={precision === 'day' ? 'date' : precision === 'month' ? 'month' : 'text'}
          inputMode={precision === 'year' ? 'numeric' : undefined}
          maxLength={precision === 'year' ? 4 : undefined}
          placeholder={precision === 'year' ? '2024' : undefined}
          value={value}
          onChange={event => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${hintId}${error ? ` ${id}-error` : ''}`}
        />
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">Optional. Choose only the detail you know. Switching to more detail clears the date.</p>
      {error && <p id={`${id}-error`} className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  )
}
