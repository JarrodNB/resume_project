/**
 * Description: Dialog that adds a certification entry or edits one.
 * Index:
 *   - CertificationFormDialog: opens the form for a credential, or a blank one when certification is null
 */
import { useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CREATE_CERTIFICATION_MUTATION, UPDATE_CERTIFICATION_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull } from './libraryFormValues'
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
  const [name, setName] = useState(certification?.name ?? '')
  const [issuer, setIssuer] = useState(certification?.issuer ?? '')
  const [issuedDate, setIssuedDate] = useState(certification?.issuedDate ?? '')
  const [expiryDate, setExpiryDate] = useState(certification?.expiryDate ?? '')
  const [credentialId, setCredentialId] = useState(certification?.credentialId ?? '')
  const [credentialUrl, setCredentialUrl] = useState(certification?.credentialUrl ?? '')
  const [description, setDescription] = useState(certification?.description ?? '')

  /** Creates or updates the certification, sending every field so a cleared one is removed. */
  async function submit() {
    const saved = await save(certification ? UPDATE_CERTIFICATION_MUTATION : CREATE_CERTIFICATION_MUTATION, {
      ...(certification ? { id: certification.id } : {}),
      attributes: {
        name: name.trim(),
        issuer: blankToNull(issuer),
        issuedDate: blankToNull(issuedDate),
        expiryDate: blankToNull(expiryDate),
        credentialId: blankToNull(credentialId),
        credentialUrl: blankToNull(credentialUrl),
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
        <LibraryField label="Certification name" required value={name} onChange={setName} maxLength={SHORT_TEXT} />
        <LibraryField label="Issuer" value={issuer} onChange={setIssuer} maxLength={SHORT_TEXT} />
        <LibraryField label="Issued" type="date" value={issuedDate} onChange={setIssuedDate} />
        <LibraryField label="Expires" type="date" value={expiryDate} onChange={setExpiryDate} />
        <LibraryField label="Credential ID" value={credentialId} onChange={setCredentialId} maxLength={SHORT_TEXT} />
        <LibraryField label="Credential URL" value={credentialUrl} onChange={setCredentialUrl} maxLength={SHORT_TEXT} />
      </div>
      <LibraryField label="Description" multiline value={description} onChange={setDescription} maxLength={PROSE_TEXT} />
    </EntryFormDialog>
  )
}
