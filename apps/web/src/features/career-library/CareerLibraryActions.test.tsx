/**
 * Description: Deleting and merging career library entries from the library page. Mutation mocks
 * only match the expected ids, so a dialog that closes means the right mutation succeeded. Mutation mocks
 * only match the expected ids, so a dialog that closes means the right mutation succeeded.
 */
import type { MockLink } from '@apollo/client/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { DELETE_SKILL_MUTATION, MERGE_EXPERIENCES_MUTATION } from './careerLibraryMutations'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { CareerLibraryPage } from './CareerLibraryPage'

function experience(id: string, title: string, startDate: string | null) {
  return {
    __typename: 'Experience',
    id,
    company: 'Acme',
    title,
    location: null,
    startDate,
    endDate: null,
    description: null,
    highlights: [],
  }
}

const libraryMock = {
  request: { query: CAREER_LIBRARY_QUERY },
  result: {
    data: {
      me: {
        __typename: 'User',
        id: 'user-1',
        name: null,
        contactEmail: null,
        phone: null,
        location: null,
        links: [],
        summary: null,
      },
      experiences: [
        experience('exp-1', 'Engineer', '2021-03-01'),
        experience('exp-2', 'Engineer', null),
        experience('exp-3', 'Manager', '2023-01-01'),
      ],
      projects: [],
      educations: [],
      skills: [{ __typename: 'Skill', id: 'skill-1', name: 'Ruby', category: null, position: 0 }],
    },
  },
}

function renderLibrary(mutationMock: MockLink.MockedResponse) {
  renderPage({
    path: '/library',
    url: '/library',
    element: <CareerLibraryPage />,
    mocks: [libraryMock, mutationMock, libraryMock],
  })
}

it('merges an entry into the one picked from the other entries in its section', async () => {
  const user = userEvent.setup()
  renderLibrary({
    request: { query: MERGE_EXPERIENCES_MUTATION, variables: { targetId: 'exp-1', sourceId: 'exp-2' } },
    result: { data: { mergeExperiences: { __typename: 'MergeExperiencesPayload', errors: [] } } },
  })

  await user.click(await screen.findByRole('button', { name: 'Actions for Engineer at Acme' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Merge into…' }))

  const dialog = await screen.findByRole('dialog')
  const options = within(dialog).getAllByRole('radio')
  expect(options.map((option) => option.getAttribute('value'))).toEqual(['exp-1', 'exp-3'])

  await user.click(within(dialog).getByLabelText('Engineer at Acme (Mar 2021 – Present)'))
  await user.click(within(dialog).getByRole('button', { name: 'Merge' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('deletes a skill after confirming', async () => {
  const user = userEvent.setup()
  renderLibrary({
    request: { query: DELETE_SKILL_MUTATION, variables: { id: 'skill-1' } },
    result: { data: { deleteSkill: { __typename: 'DeleteSkillPayload', errors: [] } } },
  })

  await user.click(await screen.findByRole('button', { name: 'Delete Ruby' }))
  const dialog = await screen.findByRole('dialog', { name: 'Delete Ruby?' })
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
