/**
 * Description: Test helper that renders a page inside a memory router and Apollo's MockedProvider.
 * Index:
 *   - renderPage: renders `element` at `url`, plus any extra routes to navigate to
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
}

/** Renders a routed page with mocked GraphQL responses; returns the router for location checks. */
export function renderPage({ path, url, element, mocks = [], extraRoutes = [] }: RenderPageOptions) {
  const router = createMemoryRouter([{ path, element }, ...extraRoutes], { initialEntries: [url] })
  const rendered = render(
    <MockedProvider mocks={mocks}>
      <RouterProvider router={router} />
    </MockedProvider>,
  )
  return { router, ...rendered }
}
