/**
 * Description: Review fields for the parsed contact info.
 * Index:
 *   - ContactFields: name, email, phone, location, and links
 */
import type { ParsedContactInfo } from '../parsedResume'
import { StringListField } from './StringListField'
import { TextField } from './TextField'

interface ContactFieldsProps {
  contact: ParsedContactInfo
  onChange: (contact: ParsedContactInfo) => void
}

/** Edits the contact block of a parsed resume. */
export function ContactFields({ contact, onChange }: ContactFieldsProps) {
  const set = <Key extends keyof ParsedContactInfo>(key: Key, value: ParsedContactInfo[Key]) =>
    onChange({ ...contact, [key]: value })

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Full name" value={contact.full_name} onChange={(value) => set('full_name', value)} />
        <TextField label="Email" value={contact.email} onChange={(value) => set('email', value)} />
        <TextField label="Phone" value={contact.phone} onChange={(value) => set('phone', value)} />
        <TextField label="Location" value={contact.location} onChange={(value) => set('location', value)} />
      </div>
      <StringListField label="Links" values={contact.links} onChange={(links) => set('links', links)} addLabel="Add link" />
    </div>
  )
}
