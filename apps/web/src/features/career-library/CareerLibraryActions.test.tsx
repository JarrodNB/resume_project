/**
 * Description: Deleting, merging, adding, and editing career library entries from the library page.
 * Mutation mocks only match the expected variables, so a dialog that closes means the right
 * mutation succeeded.
 */
import type { MockLink } from '@apollo/client/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { setSectionOpen } from '@/lib/openSections'
import { renderPage } from '@/test/renderPage'
import { DELETE_SKILL_MUTATION, MERGE_EXPERIENCES_MUTATION } from './careerLibraryMutations'
import { CREATE_EXPERIENCE_MUTATION, CREATE_SKILL_MUTATION, UPDATE_LIBRARY_FACT_MUTATION, UPDATE_PROFILE_MUTATION, UPDATE_PROJECT_MUTATION } from './careerLibrarySaveMutations'
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
      libraryFacts: [],
    },
  },
}

function renderLibrary(
  mutationMock: MockLink.MockedResponse,
  sections = ['library.experience', 'library.skills'],
  library: MockLink.MockedResponse = libraryMock,
) {
  for (const sectionId of sections) setSectionOpen(sectionId, true)
  renderPage({
    path: '/library',
    url: '/library',
    element: <CareerLibraryPage />,
    mocks: [library, mutationMock, library],
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

it('adds a role', async () => {
  const user = userEvent.setup()
  renderLibrary({
    request: {
      query: CREATE_EXPERIENCE_MUTATION,
      variables: {
        attributes: { company: 'Acme', title: 'Engineer', location: null, startDate: null, endDate: null, description: null },
        highlights: [],
      },
    },
    result: { data: { createExperience: { __typename: 'CreateExperiencePayload', errors: [] } } },
  })

  await user.click(await screen.findByRole('button', { name: 'Add role' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add role' })
  await user.type(within(dialog).getByLabelText('Title'), 'Engineer')
  await user.type(within(dialog).getByLabelText('Company'), 'Acme')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('edits a project and can clear a field', async () => {
  const user = userEvent.setup()
  const library = {
    ...libraryMock,
    result: {
      data: {
        ...libraryMock.result.data,
        projects: [
          {
            __typename: 'Project',
            id: 'project-1',
            name: 'CLI',
            role: 'Author',
            url: null,
            startDate: null,
            endDate: null,
            description: null,
          },
        ],
      },
    },
  }
  renderLibrary(
    {
      request: {
        query: UPDATE_PROJECT_MUTATION,
        variables: {
          id: 'project-1',
          attributes: { name: 'CLI', role: null, url: null, startDate: null, endDate: null, description: null },
        },
      },
      result: { data: { updateProject: { __typename: 'UpdateProjectPayload', errors: [] } } },
    },
    ['library.projects'],
    library,
  )

  await user.click(await screen.findByRole('button', { name: 'Actions for CLI' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit project' })
  await user.clear(within(dialog).getByLabelText('Role'))
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('edits the profile', async () => {
  const user = userEvent.setup()
  renderLibrary(
    {
      request: {
        query: UPDATE_PROFILE_MUTATION,
        variables: {
          attributes: { name: 'Ada', contactEmail: null, phone: null, location: null, links: [], summary: null },
        },
      },
      result: { data: { updateProfile: { __typename: 'UpdateProfilePayload', errors: [] } } },
    },
    ['library.profile'],
  )

  await user.click(await screen.findByRole('button', { name: 'Edit profile' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit profile' })
  await user.type(within(dialog).getByLabelText('Name'), 'Ada')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('adds a skill', async () => {
  const user = userEvent.setup()
  renderLibrary({
    request: {
      query: CREATE_SKILL_MUTATION,
      variables: { attributes: { name: 'Go', category: null } },
    },
    result: { data: { createSkill: { __typename: 'CreateSkillPayload', errors: [] } } },
  })

  await user.click(await screen.findByRole('button', { name: 'Add skill' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add skill' })
  await user.type(within(dialog).getByLabelText('Name'), 'Go')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('keeps a validation error in the skill dialog', async () => {
  const user = userEvent.setup()
  renderLibrary({
    request: {
      query: CREATE_SKILL_MUTATION,
      variables: { attributes: { name: 'Ruby', category: null } },
    },
    result: { data: { createSkill: { __typename: 'CreateSkillPayload', errors: ['Name has already been taken'] } } },
  })

  await user.click(await screen.findByRole('button', { name: 'Add skill' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add skill' })
  await user.type(within(dialog).getByLabelText('Name'), 'Ruby')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  expect(await within(dialog).findByText('Name has already been taken')).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Add skill' })).toBeInTheDocument()
})

it('edits a fact', async () => {
  const user = userEvent.setup()
  const library = {
    ...libraryMock,
    result: {
      data: {
        ...libraryMock.result.data,
        libraryFacts: [{ __typename: 'LibraryFact', id: 'fact-1', requirement: 'Kubernetes', response: 'Used it at Acme' }],
      },
    },
  }
  renderLibrary(
    {
      request: {
        query: UPDATE_LIBRARY_FACT_MUTATION,
        variables: { id: 'fact-1', attributes: { requirement: 'Kubernetes', response: 'Used it for two years' } },
      },
      result: { data: { updateLibraryFact: { __typename: 'UpdateLibraryFactPayload', errors: [] } } },
    },
    ['library.facts'],
    library,
  )

  await user.click(await screen.findByRole('button', { name: 'Edit Kubernetes' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit fact' })
  await user.clear(within(dialog).getByLabelText('Response'))
  await user.type(within(dialog).getByLabelText('Response'), 'Used it for two years')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
