/**
 * Description: Labelled text, date, or multiline field for a career library form.
 * Index:
 *   - LibraryField: controlled field
 */
import { useId, type ChangeEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface LibraryFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  multiline?: boolean
  type?: 'text' | 'date' | 'email' | 'tel' | 'url'
  disabled?: boolean
  maxLength?: number
}

/** Renders a label plus an input, a date input, or a textarea. */
export function LibraryField({ label, value, onChange, required, multiline, type = 'text', disabled, maxLength }: LibraryFieldProps) {
  const id = useId()
  const shared = {
    id,
    value,
    required,
    disabled,
    maxLength,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? <Textarea {...shared} rows={3} /> : <Input {...shared} type={type} />}
    </div>
  )
}
