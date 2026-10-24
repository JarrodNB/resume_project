/**
 * Description: The user's profile in the career library: name, contact details, links, and summary.
 * The card starts collapsed; opening it is remembered in this browser. Edit opens the profile form.
 * Only the summary has AI review and individual regeneration; contact details remain manual.
 * Index:
 *   - ProfileSection: profile card with an empty state and an edit button
 */
import { useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { LibraryAssessment } from './LibraryAssessment'
import { LibraryEditControl } from './LibraryEditControl'
import { useLibraryReview } from './useLibraryReview'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/ui/button'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { ProfileFormDialog } from './ProfileFormDialog'

type Profile = CareerLibraryQuery['me']

/** Shows the profile and opens the form that edits it. */
export function ProfileSection({ profile }: { profile: Profile }) {
  const review = useLibraryReview('summary', profile.summary ?? '')
  const [editing, setEditing] = useState(false)
  const contactLine = [profile.contactEmail, profile.phone, profile.location].filter(Boolean).join(' · ')
  const isEmpty = !profile.name && !contactLine && profile.links.length === 0 && !profile.summary

  return (
    <SectionCard sectionId="library.profile" tone="contact" title="Profile" contentClassName="grid gap-2">
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Summary</h3>
              <Button variant="outline" size="sm" disabled={review.busy || !profile.summary} onClick={() => void review.start()}>{review.busy ? 'Reviewing…' : 'Review Summary'}</Button>
            </div>
            <ErrorAlert title="Could not review Summary" messages={review.errors} />
            {profile.summary ? <>
              <p className="text-sm">{profile.summary}</p>
              <LibraryAssessment assessment={review.assessments.find((item) => item.kind === 'user' && item.recordId === profile.id)} />
              <LibraryEditControl kind="user" recordId={profile.id} currentText={profile.summary} sourceRevision={profile.summary} />
            </> : <p className="text-sm text-muted-foreground">Add a summary to review or improve it with AI.</p>}
          </div>
        </>
      )}
      <ProfileFormDialog open={editing} onOpenChange={setEditing} profile={profile} />
    </SectionCard>
  )
}
