/**
 * Description: Labelled text input or textarea for nullable string fields of a ParsedResume.
 * Index:
 *   - TextField: controlled field; an emptied input reports null
 */
import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface TextFieldProps {
  label: string
  value: string | null
  onChange: (value: string | null) => void
  multiline?: boolean
  required?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
}

/** Renders a label plus input (or textarea when `multiline`). Empty text becomes null. */
export function TextField({ label, value, onChange, multiline, required, disabled, placeholder, className }: TextFieldProps) {
  const id = useId()
  const inputProps = {
    id,
    value: value ?? '',
    required,
    disabled,
    placeholder,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value === '' ? null : event.target.value),
  }

  return (
    <div className={className ?? 'grid gap-1.5'}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {multiline ? <Textarea rows={3} {...inputProps} /> : <Input {...inputProps} />}
    </div>
  )
}
