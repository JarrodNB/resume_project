/**
 * Description: The user's profile in the career library: name, contact details, links, and summary.
 * The card starts collapsed; opening it is remembered in this browser. Edit opens the profile form.
 * Only the summary has AI review and individual regeneration; contact details remain manual.
 * Index:
 *   - ProfileSection: profile card with an empty state and an edit button
 */
import { useState } from 'react'
import { ReviewQuestionsBadge } from './ReviewQuestionsBadge'
import { LibrarySectionReview } from './LibrarySectionReview'
import { LibraryDetail } from './LibraryDetail'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/ui/button'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { ProfileFormDialog } from './ProfileFormDialog'

type Profile = CareerLibraryQuery['me']

/** Shows the profile and opens the form that edits it. */
export function ProfileSection({ profile }: { profile: Profile }) {
  const [editing, setEditing] = useState(false)
  const contactLine = [profile.contactEmail, profile.phone, profile.location].filter(Boolean).join(' · ')
  const isEmpty = !profile.name && !contactLine && profile.links.length === 0 && !profile.summary

  return (
    <SectionCard sectionId="library.profile" tone="contact" title="Profile" badge={<ReviewQuestionsBadge section="summary" />} contentClassName="grid gap-2">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit profile
        </Button>
      </div>
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">Add your contact details and summary, or import a resume.</p>
      ) : (
        <>
          {profile.name && <h3 className="font-medium">{profile.name}</h3>}
          {contactLine && <p className="text-sm text-muted-foreground">{contactLine}</p>}
          {profile.links.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
              {profile.links.map((link) => (
                <li key={link.url}><a className="underline-offset-4 hover:underline" href={link.url}>{link.label}</a></li>
              ))}
            </ul>
          )}
          <div className="mt-2 grid gap-2 border-t pt-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="pt-1 text-sm font-medium">Summary</h3>
              <LibrarySectionReview section="summary" />
            </div>

            {profile.summary ? <>
              <LibraryDetail kind="user" recordId={profile.id} text={profile.summary} />
            </> : <p className="text-sm text-muted-foreground">Add a summary to review or improve it with AI.</p>}
          </div>
        </>
      )}
      <ProfileFormDialog open={editing} onOpenChange={setEditing} profile={profile} />
    </SectionCard>
  )
}
