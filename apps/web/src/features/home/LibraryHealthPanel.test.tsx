/** Checks Home's Library lane: what the library holds, the grade bar, the next step, and quiet failure. */
import { screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { LIBRARY_REVIEW_QUERY } from '@/features/career-library/libraryReviewOperations'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { LibraryHealthPanel } from './LibraryHealthPanel'

const library = {
  me: { id: 'u1', name: 'Jane', summary: null },
  experiences: [{ id: 'e1', company: 'Acme', title: 'Engineer', description: 'Built things', highlights: [{ id: 'h1', content: 'Cut costs', position: 1 }] }],
  projects: [{ id: 'p1', name: 'Site', description: 'A site' }],
  educations: [], certifications: [], careerContexts: [],
  skills: [{ id: 's1', name: 'Ruby' }, { id: 's2', name: 'SQL' }],
} as unknown as CareerLibraryQuery

type Assessment = { kind: string; recordId: string; color: string; stale?: boolean; question?: string; reviewTaskId?: string }

function review(assessments: Assessment[] = [], aiTask: unknown = null) {
  return { __typename: 'LibraryReview', aiTask, assessments: assessments.map((item) => ({ __typename: 'LibraryAssessment', field: '', reason: 'Reason', question: null, questions: [], reviewTaskId: null, stale: false, ...item })) }
}

function renderLibrary(sections: Partial<Record<'summary' | 'experience' | 'projects' | 'career_contexts', unknown>>) {
  const mocks = (['summary', 'experience', 'projects', 'career_contexts'] as const).map((section) => (
    { request: { query: LIBRARY_REVIEW_QUERY, variables: { section } }, result: { data: { libraryReview: sections[section] ?? review() } } }
  ))
  return renderPage({ path: '/', url: '/', element: <LibraryHealthPanel library={library} />, mocks: mocks as never })
}

it('summarizes what the library holds and grades its details in a bar', async () => {
  renderLibrary({
    experience: review([{ kind: 'experience', recordId: 'e1', color: 'green' }, { kind: 'experience_highlight', recordId: 'h1', color: 'red' }]),
  })
  const lane = await screen.findByRole('region', { name: 'Library' })
  expect(within(lane).getByText('1 role · 1 project · 2 skills')).toBeInTheDocument()
  expect(await within(lane).findByRole('img', { name: '3 reviewable details: 1 look good, 1 need work, 1 not reviewed' })).toBeInTheDocument()
  expect(within(lane).getByRole('link', { name: 'Improve weak details: your library' })).toHaveAttribute('href', '/library')
  expect(within(lane).getByText('1 detail needs work.')).toBeInTheDocument()
})

it('asks the user to run a review when nothing has been reviewed', async () => {
  renderLibrary({})
  expect(await screen.findByRole('link', { name: 'Review your library: your library' })).toBeInTheDocument()
})

it('puts a waiting review question first', async () => {
  renderLibrary({ projects: review([{ kind: 'project', recordId: 'p1', color: 'yellow', question: 'How big?', reviewTaskId: 't1' }]) })
  expect(await screen.findByRole('link', { name: 'Answer review questions: your library' })).toBeInTheDocument()
})

it('shows the AI working while a review is running', async () => {
  renderLibrary({ summary: review([], { __typename: 'AiTask', id: 't9', status: 'QUEUED', errorMessage: null }) })
  expect(await screen.findByRole('link', { name: 'Reviewing your library: your library' })).toBeInTheDocument()
})

it('says looking good only when every detail is reviewed and good', async () => {
  renderLibrary({
    experience: review([{ kind: 'experience', recordId: 'e1', color: 'green' }, { kind: 'experience_highlight', recordId: 'h1', color: 'green' }]),
    projects: review([{ kind: 'project', recordId: 'p1', color: 'green' }]),
  })
  expect(await screen.findByRole('link', { name: 'Looking good: your library' })).toBeInTheDocument()
})

it('still shows the counts and a quiet note when reviews cannot load', async () => {
  renderPage({ path: '/', url: '/', element: <LibraryHealthPanel library={library} />, mocks: (['summary', 'experience', 'projects', 'career_contexts'] as const).map((section) => (
    { request: { query: LIBRARY_REVIEW_QUERY, variables: { section } }, error: new Error('Network down') }
  )) as never })
  expect(await screen.findByText(/Couldn’t load your library reviews/)).toBeInTheDocument()
  expect(screen.getByText('1 role · 1 project · 2 skills')).toBeInTheDocument()
})
