/** Verifies that a scoped move updates cached evidence once and sends explicit ownership. */
import type { ReactNode } from 'react'
import { InMemoryCache } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing/react'
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { MOVE_EXPERIENCE_HIGHLIGHT_MUTATION } from './careerLibraryReorderMutations'
import { useLibraryReordering } from './useLibraryReordering'

it('moves a role bullet into shared scope in the same cached experience', async () => {
  const cache = new InMemoryCache()
  const entry = {
    __typename: 'Experience', id: 'entry', company: 'Example', title: 'Lead', location: null, startDate: null, endDate: null, description: null,
    roles: [{__typename: 'ExperienceRole', id: 'role', title: 'Lead', startDate: null, endDate: null, description: null, position: 0}],
    highlights: [{__typename: 'ExperienceHighlight', id: 'bullet', content: 'Evidence', experienceRoleId: 'role', position: 0}],
  }
  const library = {me: {__typename: 'User', id: 'user', name: null, contactEmail: null, phone: null, location: null, links: [], summary: null},
    experiences: [entry], projects: [], educations: [], certifications: [], skills: [], libraryFacts: []}
  cache.writeQuery({query: CAREER_LIBRARY_QUERY, data: library})
  const moved = {...entry.highlights[0], experienceRoleId: null}
  const wrapper = ({children}: {children: ReactNode}) => <MockedProvider cache={cache} mocks={[{
    request: {query: MOVE_EXPERIENCE_HIGHLIGHT_MUTATION, variables: {highlightId: 'bullet', experienceId: 'entry', experienceRoleId: null, position: 0}},
    result: {data: {moveExperienceHighlight: {__typename: 'MoveExperienceHighlightPayload', errors: [],
      experience: {__typename: 'Experience', id: 'entry', highlights: [moved]}, sourceExperience: {__typename: 'Experience', id: 'entry', highlights: [moved]}}}},
  }]}>{children}</MockedProvider>
  const {result} = renderHook(() => useLibraryReordering(), {wrapper})
  await act(async () => {
    await result.current.moveHighlight('bullet', {experienceId: 'entry', experienceRoleId: 'role', index: 0}, {experienceId: 'entry', experienceRoleId: null, index: 0})
  })
  expect(result.current.errors).toEqual([])
  expect(cache.readQuery({query: CAREER_LIBRARY_QUERY})?.experiences[0].highlights).toEqual([moved])
})
