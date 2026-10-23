/** Choose a resume by dropping a file or opening the file picker.
 * Invalid files are announced and associated with the picker for recovery.
 */
import { useId, useState, type ChangeEvent, type DragEvent } from 'react'
import { FileUp, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCEPTED_RESUME_FILE_TYPES, validateResumeFile } from './resumeFileValidation'

interface ResumeDropzoneProps {
  onFileSelected: (file: File) => void
  busy?: boolean
}

/** Accepts one PDF/DOCX by drop or file picker; shows validation errors inline. */
export function ResumeDropzone({ onFileSelected, busy = false }: ResumeDropzoneProps) {
  const inputId = useId()
  const helpId = `${inputId}-help`
  const errorId = `${inputId}-error`
  const [dragging, setDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  function selectFile(file: File | undefined) {
    if (!file || busy) return
    const error = validateResumeFile(file)
    setValidationError(error)
    if (!error) onFileSelected(file)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    selectFile(event.dataTransfer.files[0])
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0])
    event.target.value = ''
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        {busy ? (
          <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
        ) : (
          <FileUp className="size-8 text-muted-foreground" />
        )}
        <span className="font-medium">{busy ? 'Uploading…' : 'Drop your resume here, or click to browse'}</span>
        <span id={helpId} className="text-sm text-muted-foreground">PDF or Word (.docx), up to 5 MB</span>
      </label>
      <input
        id={inputId}
        type="file"
        aria-label="Resume file"
        aria-describedby={validationError ? `${helpId} ${errorId}` : helpId}
        aria-invalid={validationError ? true : undefined}
        accept={ACCEPTED_RESUME_FILE_TYPES}
        className="sr-only"
        disabled={busy}
        onChange={handleChange}
      />
      {validationError && <p id={errorId} role="alert" className="text-sm text-destructive">{validationError}</p>}
    </div>
  )
}
