/**
 * Description: The user's profile in the career library: name, contact details, links, and summary.
 * Index:
 *   - ProfileSection: profile card with an empty state
 */
import { SectionCard } from '@/components/SectionCard'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'

type Profile = CareerLibraryQuery['me']

/** Shows the profile; says so when nothing has been filled in yet. */
export function ProfileSection({ profile }: { profile: Profile }) {
  const contactLine = [profile.contactEmail, profile.phone, profile.location].filter(Boolean).join(' · ')
  const isEmpty = !profile.name && !contactLine && profile.links.length === 0 && !profile.summary

  return (
    <SectionCard tone="contact" title="Profile" contentClassName="grid gap-2">
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">Import a resume to fill in your contact details and summary.</p>
      ) : (
        <>
          {profile.name && <h3 className="font-medium">{profile.name}</h3>}
          {contactLine && <p className="text-sm text-muted-foreground">{contactLine}</p>}
          {profile.links.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
              {profile.links.map((link) => (
                <li key={link}>{link}</li>
              ))}
            </ul>
          )}
          {profile.summary && <p className="text-sm">{profile.summary}</p>}
        </>
      )}
    </SectionCard>
  )
}
