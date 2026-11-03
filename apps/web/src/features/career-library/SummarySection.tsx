/**
 * Description: The professional summary in the career library. It has its own card so it can be
 * placed among the other resume sections; contact details stay in the profile card at the top.
 * Supports explicit missing-text generation, review and individual improvement.
 * Index:
 *   - SummarySection: summary card with its resume inclusion default
 */
import { useState, type ReactNode } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/ui/button'
import { SummaryInclusionControl } from '@/features/resume-tailoring/SummaryInclusionControl'
import { SummaryGenerationPanel } from '@/features/summary-generation/SummaryGenerationPanel'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { UPDATE_PROFILE_MUTATION } from './careerLibrarySaveMutations'
import { LibraryDetail } from './LibraryDetail'
import { LibrarySectionReview } from './LibrarySectionReview'
import { ProfileFormDialog } from './ProfileFormDialog'
import { ReviewQuestionsBadge } from './ReviewQuestionsBadge'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

/** Shows the summary, or offers to write one when it is missing. */
export function SummarySection({ profile, dragHandle }: { profile: CareerLibraryQuery['me']; dragHandle?: ReactNode }) {
  const preference = useSaveLibraryRecord()
  const client = useApolloClient()
  const [editing, setEditing] = useState(false)

  return (
    <SectionCard sectionId="library.summary" tone="summary" title="Summary" dragHandle={dragHandle} badge={<ReviewQuestionsBadge section="summary" />} contentClassName="grid gap-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
          Edit summary
        </Button>
        {profile.summary && <LibrarySectionReview section="summary" />}
      </div>
      <SummaryInclusionControl checked={profile.includeSummary !== false} disabled={preference.busy} description="Default for new resumes. Existing resumes keep their own setting." onChange={(checked) => void preference.save(UPDATE_PROFILE_MUTATION, { attributes: { includeSummary: checked } })} />
      <ErrorAlert messages={preference.errors} title="Couldn't save your summary preference" />
      {profile.summary ? <LibraryDetail kind="user" recordId={profile.id} text={profile.summary} /> :
        <SummaryGenerationPanel targetKind="profile" targetId={profile.id} onAccepted={() => client.refetchQueries({ include: [CAREER_LIBRARY_QUERY] })} />}
      <ProfileFormDialog open={editing} onOpenChange={setEditing} profile={profile} />
    </SectionCard>
  )
}
