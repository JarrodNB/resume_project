/**
 * Description: Test helper that renders a page inside a memory router and Apollo's MockedProvider.
 * Index:
 *   - renderPage: renders `element` at `url`, plus any extra routes to navigate to.
 *     `historyState` is the location state for that first entry.
 */
import type { ReactElement } from 'react'
import type { MockLink } from '@apollo/client/testing'
import { MockedProvider } from '@apollo/client/testing/react'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'

interface RenderPageOptions {
  path: string
  url: string
  element: ReactElement
  mocks?: MockLink.MockedResponse[]
  extraRoutes?: RouteObject[]
  historyState?: unknown
}

/** Renders a routed page with mocked GraphQL responses; returns the router for location checks. */
export function renderPage({ path, url, element, mocks = [], extraRoutes = [], historyState }: RenderPageOptions) {
  const router = createMemoryRouter([{ path, element }, ...extraRoutes], {
    initialEntries: [historyState === undefined ? url : { pathname: url, state: historyState }],
  })
  const rendered = render(
    <MockedProvider mocks={mocks}>
      <RouterProvider router={router} />
    </MockedProvider>,
  )
  return { router, ...rendered }
}
