/**
 * Description: The professional summary in the career library. It has its own section so it can be
 * placed among the other resume sections; contact details stay in the profile at the top.
 * Supports explicit missing-text generation, review and individual improvement.
 * Index:
 *   - SummarySection: summary text with its resume inclusion default
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

/** Shows the summary, or offers to write one when it is missing. */
export function SummarySection({ profile }: { profile: CareerLibraryQuery['me'] }) {
  const preference = useSaveLibraryRecord()
  const client = useApolloClient()
  const [editing, setEditing] = useState(false)

  return (
    <LibrarySectionFrame sectionId={LIBRARY_SECTION_ANCHORS.summary} title="Summary" reviewSection="summary" actions={<>
      {profile.summary && <LibrarySectionReview section="summary" />}
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
        Edit summary
      </Button>
    </>}>
      <div className="library-summary">
        {profile.summary ? <LibraryDetail kind="user" recordId={profile.id} text={profile.summary} /> :
          <SummaryGenerationPanel targetKind="profile" targetId={profile.id} onAccepted={() => client.refetchQueries({ include: [CAREER_LIBRARY_QUERY] })} />}
        <SummaryInclusionControl checked={profile.includeSummary !== false} disabled={preference.busy} description="Default for new resumes. Existing resumes keep their own setting." onChange={(checked) => void preference.save(UPDATE_PROFILE_MUTATION, { attributes: { includeSummary: checked } })} />
        <ErrorAlert messages={preference.errors} title="Couldn't save your summary preference" />
      </div>
      <ProfileFormDialog open={editing} onOpenChange={setEditing} profile={profile} />
    </LibrarySectionFrame>
  )
}
