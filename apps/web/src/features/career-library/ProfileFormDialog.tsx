/**
 * Description: Dialog that edits the career library profile.
 * Index:
 *   - ProfileFormDialog: name, contact details, links (one per line), and summary
 */
import { useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { UPDATE_PROFILE_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull } from './libraryFormValues'
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
  const [links, setLinks] = useState(profile.links.join('\n'))
  const [summary, setSummary] = useState(profile.summary ?? '')

  /** Saves every profile field. Blank text is cleared; blank lines are dropped from links. */
  async function submit() {
    const saved = await save(UPDATE_PROFILE_MUTATION, {
      attributes: {
        name: blankToNull(name),
        contactEmail: blankToNull(contactEmail),
        phone: blankToNull(phone),
        location: blankToNull(location),
        links: links.split('\n').map((link) => link.trim()).filter(Boolean),
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
        <LibraryField label="Name" value={name} onChange={setName} />
        <LibraryField label="Contact email" type="email" value={contactEmail} onChange={setContactEmail} />
        <LibraryField label="Phone" type="tel" value={phone} onChange={setPhone} />
        <LibraryField label="Location" value={location} onChange={setLocation} />
      </div>
      <LibraryField label="Links" multiline value={links} onChange={setLinks} />
      <LibraryField label="Summary" multiline value={summary} onChange={setSummary} />
    </EntryFormDialog>
  )
}
