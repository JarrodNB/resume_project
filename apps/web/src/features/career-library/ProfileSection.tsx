/**
 * Description: The user's contact details in the career library: name, contact details, and links.
 * It always stays first, like the contact header on a resume. Edit opens the profile form;
 * contact details remain manual.
 * Index:
 *   - ProfileSection: name and contact line with an empty state and an edit button
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { ProfileFormDialog } from './ProfileFormDialog'

type Profile = CareerLibraryQuery['me']

/** Shows the profile and opens the form that edits it. */
export function ProfileSection({ profile }: { profile: Profile }) {
  const [editing, setEditing] = useState(false)
  const contactLine = [profile.contactEmail, profile.phone, profile.location].filter(Boolean).join(' · ')
  const isEmpty = !profile.name && !contactLine && profile.links.length === 0

  return (
    <section className="library-profile" aria-label="Profile">
      <div className="min-w-0">
        <h2>{profile.name || 'Your profile'}</h2>
        {isEmpty && <p>Add your contact details, or import a resume.</p>}
        {contactLine && <p>{contactLine}</p>}
        {profile.links.length > 0 && (
          <ul>
            {profile.links.map((link) => (
              <li key={link.url}><a className="underline-offset-4 hover:underline" href={link.url}>{link.label}</a></li>
            ))}
          </ul>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
        Edit profile
      </Button>
      <ProfileFormDialog open={editing} onOpenChange={setEditing} profile={profile} />
    </section>
  )
}
