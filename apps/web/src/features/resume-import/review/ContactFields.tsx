/**
 * Description: Review fields for the parsed contact info.
 * Index:
 *   - ContactFields: name, email, phone, location, and links
 */
import { SHORT_TEXT } from '@/lib/textLimits'
import type { ParsedContactInfo } from '../parsedResume'
import { LinkListField } from './LinkListField'
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
        <TextField label="Full name" maxLength={SHORT_TEXT} value={contact.full_name} onChange={(value) => set('full_name', value)} />
        <TextField label="Email" maxLength={SHORT_TEXT} value={contact.email} onChange={(value) => set('email', value)} />
        <TextField label="Phone" maxLength={SHORT_TEXT} value={contact.phone} onChange={(value) => set('phone', value)} />
        <TextField label="Location" maxLength={SHORT_TEXT} value={contact.location} onChange={(value) => set('location', value)} />
      </div>
      <LinkListField maxLength={SHORT_TEXT} links={contact.links} onChange={(links) => set('links', links)} />
    </div>
  )
}
