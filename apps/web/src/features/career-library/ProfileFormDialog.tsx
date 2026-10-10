/**
 * Description: Dialog that edits the career library profile.
 * Index:
 *   - ProfileFormDialog: name, contact details, labelled links, and summary
 */
import { useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { UPDATE_PROFILE_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull } from './libraryFormValues'
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import { LinkListField } from '@/features/resume-import/review/LinkListField'
import { LibraryField } from './LibraryField'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

type Profile = CareerLibraryQuery['me']

interface ProfileFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Profile
}

/** Shows the profile form while `open` is true. */
export function ProfileFormDialog({ open, onOpenChange, profile }: ProfileFormDialogProps) {
  if (!open) return null
  return <ProfileForm profile={profile} onClose={() => onOpenChange(false)} />
}

/** The profile fields and the save action. */
function ProfileForm({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const [name, setName] = useState(profile.name ?? '')
  const [contactEmail, setContactEmail] = useState(profile.contactEmail ?? '')
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [location, setLocation] = useState(profile.location ?? '')
  const [links, setLinks] = useState(profile.links)
  const [summary, setSummary] = useState(profile.summary ?? '')

  /** Saves every profile field. Blank text and incomplete links are dropped. */
  async function submit() {
    const saved = await save(UPDATE_PROFILE_MUTATION, {
      attributes: {
        name: blankToNull(name),
        contactEmail: blankToNull(contactEmail),
        phone: blankToNull(phone),
        location: blankToNull(location),
        links: links.filter((link) => link.label.trim() && link.url.trim()).map((link) => ({ label: link.label.trim(), url: link.url.trim() })),
        summary: blankToNull(summary),
      },
    })
    if (saved) onClose()
  }

  return (
    <EntryFormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Edit profile"
      description="This is what tailored resumes copy. Your sign-in email stays the same."
      onSubmit={submit}
      busy={busy}
      errors={errors}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LibraryField label="Name" value={name} onChange={setName} maxLength={SHORT_TEXT} />
        <LibraryField label="Contact email" type="email" value={contactEmail} onChange={setContactEmail} maxLength={SHORT_TEXT} />
        <LibraryField label="Phone" type="tel" value={phone} onChange={setPhone} maxLength={SHORT_TEXT} />
        <LibraryField label="Location" value={location} onChange={setLocation} maxLength={SHORT_TEXT} />
      </div>
      <LinkListField links={links} onChange={setLinks} maxLength={SHORT_TEXT} />
      <LibraryField label="Summary" multiline value={summary} onChange={setSummary} maxLength={PROSE_TEXT} />
    </EntryFormDialog>
  )
}
