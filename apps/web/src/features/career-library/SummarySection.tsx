/**
 * Description: The professional summary in the career library. It has its own section so it can be
 * placed among the other resume sections; contact details stay in the profile at the top.
 * Supports explicit missing-text generation, review and individual improvement.
 * Index:
 *   - SummarySection: summary text, with its default for new resumes in the heading row
 */
import { useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { SummaryInclusionControl } from '@/features/resume-tailoring/SummaryInclusionControl'
import { SummaryGenerationPanel } from '@/features/summary-generation/SummaryGenerationPanel'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { UPDATE_PROFILE_MUTATION } from './careerLibrarySaveMutations'
import { LibraryDetail } from './LibraryDetail'
import { LibrarySectionReview } from './LibrarySectionReview'
import { ProfileFormDialog } from './ProfileFormDialog'
import { LibrarySectionFrame } from './LibrarySection'
import { LIBRARY_SECTION_ANCHORS } from './librarySectionLinks'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

/** Shows the summary, or offers to write one when it is missing and the library has content to write from. */
export function SummarySection({ profile, libraryHasContent }: { profile: CareerLibraryQuery['me']; libraryHasContent: boolean }) {
  const preference = useSaveLibraryRecord()
  const client = useApolloClient()
  const [editing, setEditing] = useState(false)

  return (
    <LibrarySectionFrame sectionId={LIBRARY_SECTION_ANCHORS.summary} title="Summary" reviewSection="summary" actions={<>
      <SummaryInclusionControl checked={!!profile.summary && profile.includeSummary !== false} disabled={preference.busy || !profile.summary} description={null} onChange={(checked) => void preference.save(UPDATE_PROFILE_MUTATION, { attributes: { includeSummary: checked } })} />
      {profile.summary && <LibrarySectionReview section="summary" />}
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
        Edit summary
      </Button>
    </>}>
      <div className="library-summary">
        {profile.summary ? <LibraryDetail kind="user" recordId={profile.id} text={profile.summary} /> :
          !libraryHasContent ? <p className="library-section-empty">Import your resume or add a role, project or skill first, then a summary can be written from it. You can also write one yourself with Edit summary.</p> :
          <SummaryGenerationPanel targetKind="profile" targetId={profile.id} onAccepted={() => client.refetchQueries({ include: [CAREER_LIBRARY_QUERY] })} />}
        <ErrorAlert messages={preference.errors} title="Couldn't save your summary preference" />
      </div>
      <ProfileFormDialog open={editing} onOpenChange={setEditing} profile={profile} />
    </LibrarySectionFrame>
  )
}
