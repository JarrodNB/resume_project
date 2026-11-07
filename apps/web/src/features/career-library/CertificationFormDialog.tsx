/**
 * Adds or edits a certification with optional dates at the precision the user knows.
 * Invalid or incomplete dates stay in the form with field errors before any save request.
 * Index:
 *   - CertificationFormDialog: opens the form for a credential, or a blank one when certification is null
 */
import { useRef, useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CREATE_CERTIFICATION_MUTATION, UPDATE_CERTIFICATION_MUTATION } from './careerLibrarySaveMutations'
import { CertificationDateField } from './CertificationDateField'
import { EntryFormDialog } from './EntryFormDialog'
import { editableCertificationDate, certificationDateAttributes, certificationDateError } from './certificationDateValues'
import { blankToNull, normalizeWebAddress, requiredFieldErrors } from './libraryFormValues'
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import { LibraryField } from './LibraryField'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

type Certification = CareerLibraryQuery['certifications'][number]

interface CertificationFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  certification: Certification | null
}

/** Shows the certification form while `open` is true. */
export function CertificationFormDialog({ open, onOpenChange, certification }: CertificationFormDialogProps) {
  if (!open) return null
  return <CertificationForm key={certification?.id ?? 'new'} certification={certification} onClose={() => onOpenChange(false)} />
}

/** The certification fields and the save action. */
function CertificationForm({ certification, onClose }: { certification: Certification | null; onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const issuedInput = useRef<HTMLInputElement>(null)
  const expiryInput = useRef<HTMLInputElement>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [name, setName] = useState(certification?.name ?? '')
  const [issuer, setIssuer] = useState(certification?.issuer ?? '')
  const [issuedDate, setIssuedDate] = useState(editableCertificationDate(certification?.issuedDate, certification?.issuedDatePrecision))
  const [expiryDate, setExpiryDate] = useState(editableCertificationDate(certification?.expiryDate, certification?.expiryDatePrecision))
  const [credentialId, setCredentialId] = useState(certification?.credentialId ?? '')
  const [credentialUrl, setCredentialUrl] = useState(certification?.credentialUrl ?? '')
  const [description, setDescription] = useState(certification?.description ?? '')

  /** Creates or updates the certification, sending every field so a cleared one is removed. */
  async function submit() {
    const missing = requiredFieldErrors({ name: { label: 'Certification name', value: name } })
    const address = normalizeWebAddress(credentialUrl)
    if (address.error) missing.credentialUrl = address.error
    const issuedError = issuedInput.current?.validity.badInput ? 'Complete the issued date or clear it.' : certificationDateError(issuedDate)
    const expiryError = expiryInput.current?.validity.badInput ? 'Complete the expiry date or clear it.' : certificationDateError(expiryDate)
    if (issuedError) missing.issuedDate = issuedError
    if (expiryError) missing.expiryDate = expiryError
    setFieldErrors(missing)
    if (Object.keys(missing).length) return
    const saved = await save(certification ? UPDATE_CERTIFICATION_MUTATION : CREATE_CERTIFICATION_MUTATION, {
      ...(certification ? { id: certification.id } : {}),
      attributes: {
        name: name.trim(),
        issuer: blankToNull(issuer),
        issuedDate: certificationDateAttributes(issuedDate).date,
        issuedDatePrecision: certificationDateAttributes(issuedDate).precision,
        expiryDate: certificationDateAttributes(expiryDate).date,
        expiryDatePrecision: certificationDateAttributes(expiryDate).precision,
        credentialId: blankToNull(credentialId),
        credentialUrl: address.value,
        description: blankToNull(description),
      },
    })
    if (saved) onClose()
  }

  return (
    <EntryFormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={certification ? 'Edit certification' : 'Add certification'}
      description="The certification name is required."
      onSubmit={submit}
      busy={busy}
      errors={errors}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LibraryField label="Certification name" required error={fieldErrors.name} value={name} onChange={setName} maxLength={SHORT_TEXT} />
        <LibraryField label="Issuer" value={issuer} onChange={setIssuer} maxLength={SHORT_TEXT} />
        <CertificationDateField inputRef={issuedInput} label="Issued" value={issuedDate} onChange={setIssuedDate} error={fieldErrors.issuedDate} />
        <CertificationDateField inputRef={expiryInput} label="Expires" value={expiryDate} onChange={setExpiryDate} error={fieldErrors.expiryDate} />
        <LibraryField label="Credential ID" value={credentialId} onChange={setCredentialId} maxLength={SHORT_TEXT} />
        <LibraryField label="Credential URL" error={fieldErrors.credentialUrl} value={credentialUrl} onChange={setCredentialUrl} maxLength={SHORT_TEXT} />
      </div>
      <LibraryField label="Description" multiline value={description} onChange={setDescription} maxLength={PROSE_TEXT} />
    </EntryFormDialog>
  )
}
