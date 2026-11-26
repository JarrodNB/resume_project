/** Old written-practice URLs use the real route table and return to the question bank. */
import { screen } from '@testing-library/react'
import { matchRoutes } from 'react-router'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { appRoutes } from './appRoutes'

it.each(['/practice/questions/set', '/practice/questions/set/question', '/interview-prep', '/interview-prep/set'])('redirects %s to the bank', async (url) => {
  const route = matchRoutes(appRoutes, url)?.at(-1)?.route
  expect(route?.element).toBeDefined()
  const { router } = renderPage({ path: route!.path!, url, element: <>{route!.element}</>,
    extraRoutes: [{ path: '/practice/questions', element: <p>Question bank</p> }] })
  expect(await screen.findByText('Question bank')).toBeVisible()
  expect(router.state.location.pathname).toBe('/practice/questions')
})
