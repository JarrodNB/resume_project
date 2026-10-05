/**
 * Description: Hook that deletes or merges career library entries of one kind, then refetches
 * the library.
 * Index:
 *   - LibraryEntryKind: the kinds of entries the library can delete
 *   - MergeableEntryKind: the kinds that can also be merged
 *   - useLibraryEntryActions: returns deleteEntry(id), mergeEntries(targetId, sourceId), busy, errors
 */
import { useState } from 'react'
import type { DocumentNode } from 'graphql'
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import {
  DELETE_EDUCATION_MUTATION,
  DELETE_EXPERIENCE_MUTATION,
  DELETE_LIBRARY_FACT_MUTATION,
  DELETE_PROJECT_MUTATION,
  DELETE_SKILL_MUTATION,
  MERGE_EDUCATIONS_MUTATION,
  MERGE_EXPERIENCES_MUTATION,
  MERGE_PROJECTS_MUTATION,
} from './careerLibraryMutations'

export type LibraryEntryKind = 'experience' | 'project' | 'education' | 'skill' | 'fact'
export type MergeableEntryKind = Exclude<LibraryEntryKind, 'skill' | 'fact'>

const DELETE_MUTATIONS: Record<LibraryEntryKind, DocumentNode> = {
  experience: DELETE_EXPERIENCE_MUTATION,
  project: DELETE_PROJECT_MUTATION,
  education: DELETE_EDUCATION_MUTATION,
  skill: DELETE_SKILL_MUTATION,
  fact: DELETE_LIBRARY_FACT_MUTATION,
}

const MERGE_MUTATIONS: Record<MergeableEntryKind, DocumentNode> = {
  experience: MERGE_EXPERIENCES_MUTATION,
  project: MERGE_PROJECTS_MUTATION,
  education: MERGE_EDUCATIONS_MUTATION,
}

type MutationPayloads = Record<string, { errors: string[] } | null>

/** Runs delete and merge mutations for `kind`; each resolves to true on success. */
export function useLibraryEntryActions(kind: LibraryEntryKind) {
  const client = useApolloClient()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  /** Runs one mutation, refetches the library, and collects any errors. */
  async function run(mutation: DocumentNode, variables: Record<string, string>): Promise<boolean> {
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
      if (payload && payload.errors.length === 0) return true
      setErrors(payload?.errors.length ? payload.errors : ['That didn’t work. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not reach the server. Please try again.')])
    } finally {
      setBusy(false)
    }
    return false
  }

  /** Deletes one entry. */
  function deleteEntry(id: string) {
    return run(DELETE_MUTATIONS[kind], { id })
  }

  /** Merges the source entry into the target entry (skills and facts can't be merged). */
  function mergeEntries(targetId: string, sourceId: string) {
    if (kind === 'skill' || kind === 'fact') return Promise.resolve(false)
    return run(MERGE_MUTATIONS[kind], { targetId, sourceId })
  }

  return { deleteEntry, mergeEntries, busy, errors, clearErrors: () => setErrors([]) }
}
