/**
 * Description: Runs one career-library save mutation, refetches the library, and shows a
 * "saved" notice that scrolls the changed section into view.
 * Index:
 *   - useSaveLibraryRecord: returns save, busy, errors, and clearErrors
 */
import { useState } from 'react'
import type { DocumentNode } from 'graphql'
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { LIBRARY_SECTION_ANCHORS } from './librarySectionLinks'
import { useLibraryNotice } from './LibrarySaveNotice'

type MutationPayloads = Record<string, { errors: string[] } | null>

const SAVED_RECORDS: Record<string, { name: string; sectionId?: string }> = {
  Experience: { name: 'Role', sectionId: LIBRARY_SECTION_ANCHORS.experience },
  Project: { name: 'Project', sectionId: LIBRARY_SECTION_ANCHORS.projects },
  Education: { name: 'Education', sectionId: LIBRARY_SECTION_ANCHORS.education },
  Certification: { name: 'Certification', sectionId: LIBRARY_SECTION_ANCHORS.certifications },
  Skill: { name: 'Skill', sectionId: LIBRARY_SECTION_ANCHORS.skills },
  CareerContext: { name: 'Career context', sectionId: LIBRARY_SECTION_ANCHORS.career_contexts },
  Profile: { name: 'Profile' },
}

/** Names what a mutation saved, from its payload key such as `createExperience`. */
function savedNotice(payloadKey: string | undefined) {
  const match = payloadKey?.match(/^(create|update)(.+)$/)
  const record = match && SAVED_RECORDS[match[2]]
  if (!match || !record) return { message: 'Saved.' }
  return { message: `${record.name} ${match[1] === 'create' ? 'added' : 'saved'}.`, sectionId: record.sectionId }
}

/** Runs `save`; it resolves to true when the mutation returned no errors. */
export function useSaveLibraryRecord() {
  const client = useApolloClient()
  const notify = useLibraryNotice()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  /** Runs the mutation, refetches the library, and keeps validation errors for the dialog. */
  async function save(mutation: DocumentNode, variables: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setErrors([])
    try {
      const { data } = await client.mutate<MutationPayloads>({
        mutation,
        variables,
        refetchQueries: [CAREER_LIBRARY_QUERY],
        awaitRefetchQueries: true,
      })
      const payload = Object.values(data ?? {})[0]
      if (payload && payload.errors.length === 0) {
        notify(savedNotice(Object.keys(data ?? {})[0]))
        return true
      }
      setErrors(payload?.errors.length ? payload.errors : ['That didn’t work. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not reach the server. Please try again.')])
    } finally {
      setBusy(false)
    }
    return false
  }

  return { save, busy, errors, clearErrors: () => setErrors([]) }
}
