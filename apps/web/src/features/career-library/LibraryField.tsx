/**
 * Description: Labelled text, date, or multiline field for a career library form. Required
 * fields show a red asterisk; an error prop shows an inline message (forms use noValidate).
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
  /** Inline message shown under the field; set after a failed save attempt. */
  error?: string
}

/** Renders a label plus an input, a date input, or a textarea. */
export function LibraryField({ label, value, onChange, required, multiline, type = 'text', disabled, maxLength, error }: LibraryFieldProps) {
  const id = useId()
  const shared = {
    id,
    value,
    'aria-required': required || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    disabled,
    maxLength,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1"><Label htmlFor={id}>{label}</Label>{required && <span className="text-sm text-destructive" aria-hidden="true">*</span>}</div>
      {multiline ? <Textarea {...shared} rows={3} /> : <Input {...shared} type={type} />}
      {error && <p id={`${id}-error`} className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  )
}
