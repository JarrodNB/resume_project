/**
 * Description: Hook that saves drag-and-drop changes in the career library (skill order and
 * highlight moves). The change is written to the Apollo cache first, so the page updates
 * immediately; if the server rejects it, the library is refetched and the error is shown.
 * Index:
 *   - HighlightPlacement: a role and an index among its highlights
 *   - useLibraryReordering: returns reorderSkills, moveHighlight, errors, clearErrors
 */
import { useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { MOVE_EXPERIENCE_HIGHLIGHT_MUTATION, REORDER_SKILLS_MUTATION } from './careerLibraryReorderMutations'

export interface HighlightPlacement {
  experienceId: string
  experienceRoleId?: string | null
  index: number
}

type Highlight = CareerLibraryQuery['experiences'][number]['highlights'][number]

const GENERIC_FAILURE = 'That didn’t work. Please try again.'

/** Returns `entries` in the order of `orderedIds`. */
function inOrder<Entry extends { id: string }>(entries: Entry[], orderedIds: string[]): Entry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  return orderedIds.map((id) => byId.get(id)).filter((entry): entry is Entry => entry !== undefined)
}

/** Returns the roles with one highlight moved from `from` to `to`. */
function withHighlightMoved(experiences: CareerLibraryQuery['experiences'], from: HighlightPlacement, to: HighlightPlacement) {
  const source = experiences.find((entry) => entry.id === from.experienceId)
  const inScope = (bullet: Highlight, placement: HighlightPlacement) => placement.experienceRoleId === undefined || bullet.experienceRoleId === placement.experienceRoleId
  const bullet = source?.highlights.filter((item) => inScope(item, from))[from.index]
  if (!bullet) return experiences
  return experiences.map((entry) => {
    let highlights = entry.highlights.filter((item) => item.id !== bullet.id)
    if (entry.id === to.experienceId) {
      const scoped = highlights.filter((item) => inScope(item, to))
      scoped.splice(to.index, 0, {...bullet, experienceRoleId: to.experienceRoleId === undefined ? bullet.experienceRoleId : to.experienceRoleId})
      highlights = [...highlights.filter((item) => !inScope(item, to)), ...scoped.map((item, position) => ({...item, position}))]
    }
    return {...entry, highlights}
  })
}

/** Reorders skills and moves highlights, updating the cache before the server answers. */
export function useLibraryReordering() {
  const client = useApolloClient()
  const [errors, setErrors] = useState<string[]>([])

  /** Writes a change into the cached library query. */
  function updateCachedLibrary(change: (library: CareerLibraryQuery) => CareerLibraryQuery) {
    client.cache.updateQuery({ query: CAREER_LIBRARY_QUERY }, (library) => (library ? change(library) : library))
  }

  /** Runs a mutation; on failure shows the errors and refetches so the page matches the server. */
  async function save(mutate: () => Promise<string[]>) {
    setErrors([])
    let failure: string[]
    try {
      failure = await mutate()
    } catch (error) {
      failure = [requestErrorMessage(error, 'Could not save the new order. Please try again.')]
    }
    if (failure.length === 0) return
    setErrors(failure)
    await client.refetchQueries({ include: [CAREER_LIBRARY_QUERY] })
  }

  /** Saves a new order for every skill. */
  function reorderSkills(orderedIds: string[]) {
    updateCachedLibrary((library) => ({ ...library, skills: inOrder(library.skills, orderedIds) }))
    return save(async () => {
      const { data } = await client.mutate({ mutation: REORDER_SKILLS_MUTATION, variables: { orderedIds } })
      return data?.reorderSkills?.errors ?? [GENERIC_FAILURE]
    })
  }

  /** Moves a highlight to another place in its role or into another role. */
  function moveHighlight(highlightId: string, from: HighlightPlacement, to: HighlightPlacement) {
    updateCachedLibrary((library) => ({ ...library, experiences: withHighlightMoved(library.experiences, from, to) }))
    return save(async () => {
      const { data } = await client.mutate({
        mutation: MOVE_EXPERIENCE_HIGHLIGHT_MUTATION,
        variables: { highlightId, experienceId: to.experienceId, position: to.index, ...(to.experienceRoleId === undefined ? {} : {experienceRoleId: to.experienceRoleId}) },
      })
      return data?.moveExperienceHighlight?.errors ?? [GENERIC_FAILURE]
    })
  }

  return { reorderSkills, moveHighlight, errors, clearErrors: () => setErrors([]) }
}
