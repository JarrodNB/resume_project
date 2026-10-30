/** Exercises saved-skill reads and visible counts using the real Apollo query seam. */
import { act, render, screen, within } from '@testing-library/react'
import { ApolloClient, InMemoryCache } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { MockLink } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { SkillMatches } from './SkillMatches'
import { SKILL_MATCHES_QUERY } from './skillMatchesOperations'

const skills = [
  { __typename: 'Skill' as const, id: 's1', name: 'Python', position: 0 },
  { __typename: 'Skill' as const, id: 's2', name: 'Java', position: 1 },
]

it('shows only saved skills in library order with counts and not-mentioned labels', async () => {
  renderPage({ path: '/', url: '/', element: <SkillMatches description="Python and PYTHON. JavaScript and Rust." />, mocks: [{
    request: { query: SKILL_MATCHES_QUERY }, result: { data: { skills } },
  }] })
  const list = await screen.findByRole('list', { name: 'Saved skill mentions' })
  expect(within(list).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Python2 mentions', 'JavaNot mentioned'])
  expect(screen.queryByText('Rust')).not.toBeInTheDocument()
})


it.each([null, '', '   '])('explains missing description %j without presenting zero counts', async description => {
  renderPage({ path: '/', url: '/', element: <SkillMatches description={description} /> })
  expect(screen.getByText('Add a job description to see skill matches.')).toBeVisible()
  expect(screen.queryByText('Not mentioned')).not.toBeInTheDocument()
})

it('explains an empty library and links to it', async () => {
  renderPage({ path: '/', url: '/', element: <SkillMatches description="Python" />, mocks: [{
    request: { query: SKILL_MATCHES_QUERY }, result: { data: { skills: [] } },
  }] })
  expect(await screen.findByRole('link', { name: 'Add skills to your career library' })).toHaveAttribute('href', '/library')
  expect(screen.queryByText('Not mentioned')).not.toBeInTheDocument()
})

it('distinguishes loading and a failed read from no mentions', async () => {
  renderPage({ path: '/', url: '/', element: <SkillMatches description="Python" />, mocks: [{
    request: { query: SKILL_MATCHES_QUERY }, error: new Error('Offline'), delay: 30,
  }] })
  expect(screen.getByRole('status')).toHaveTextContent('Loading your skills')
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your skills")
  expect(screen.queryByText('Not mentioned')).not.toBeInTheDocument()
})

it('refreshes saved skills on mount and recomputes when description or cached library changes', async () => {
  const cache = new InMemoryCache()
  cache.writeQuery({ query: SKILL_MATCHES_QUERY, data: { skills } })
  const freshSkills = [{ ...skills[0], name: 'Rust' }]
  const client = new ApolloClient({ cache, link: new MockLink([{
    request: { query: SKILL_MATCHES_QUERY }, result: { data: { skills: freshSkills } }, delay: 30,
  }]) })
  const view = (description: string) => (
    <ApolloProvider client={client}><MemoryRouter><SkillMatches description={description} /></MemoryRouter></ApolloProvider>
  )
  const { rerender } = render(view('Rust'))
  expect(screen.getByRole('status')).toHaveTextContent('Loading your skills')
  expect(await screen.findByText('Rust')).toBeVisible()
  expect(screen.getByText('1 mention')).toBeVisible()
  expect(screen.queryByText('Python')).not.toBeInTheDocument()
  rerender(view('Rust and RUST'))
  expect(screen.getByText('2 mentions')).toBeVisible()
  act(() => cache.writeQuery({ query: SKILL_MATCHES_QUERY, data: { skills } }))
  expect(await screen.findByText('Python')).toBeVisible()
  expect(screen.getAllByText('Not mentioned')).toHaveLength(2)
  expect(screen.queryByText('Rust')).not.toBeInTheDocument()
})
