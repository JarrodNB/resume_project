/**
 * Description: Review fields for a certification, reused in tailored resume editing.
 * Index:
 *   - CertificationFields: name, issuer, dates, credential identifiers, and description
 */
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import type { ParsedCertification } from '../parsedResume'
import { TextField } from './TextField'

/** Edits all certification fields, preserving partial dates from imported resumes. */
export function CertificationFields({ certification, onChange }: {
  certification: ParsedCertification
  onChange: (certification: ParsedCertification) => void
}) {
  /** Updates one nullable field in the certification. */
  function set(key: keyof ParsedCertification, value: string | null) {
    onChange({ ...certification, [key]: key === 'name' ? value ?? '' : value })
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Certification name" required maxLength={SHORT_TEXT} value={certification.name} onChange={(value) => set('name', value)} />
        <TextField label="Issuer" maxLength={SHORT_TEXT} value={certification.issuer} onChange={(value) => set('issuer', value)} />
        <TextField label="Issued date" placeholder="YYYY-MM or YYYY" value={certification.issued_date} onChange={(value) => set('issued_date', value)} />
        <TextField label="Expiry date" placeholder="YYYY-MM or YYYY" value={certification.expiry_date} onChange={(value) => set('expiry_date', value)} />
        <TextField label="Credential ID" maxLength={SHORT_TEXT} value={certification.credential_id} onChange={(value) => set('credential_id', value)} />
        <TextField label="Credential URL" maxLength={SHORT_TEXT} value={certification.credential_url} onChange={(value) => set('credential_url', value)} />
      </div>
      <TextField label="Description" multiline maxLength={PROSE_TEXT} value={certification.description} onChange={(value) => set('description', value)} />
    </div>
  )
}
