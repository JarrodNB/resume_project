/**
 * Description: Root component: session, Apollo Client, and router.
 * Index:
 *   - App: wraps the router in AuthProvider and SessionApolloProvider
 */
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { appRoutes } from '@/appRoutes'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { SessionApolloProvider } from '@/graphql/SessionApolloProvider'

const router = createBrowserRouter(appRoutes)

/** Renders the whole app. */
export default function App() {
  return (
    <AuthProvider>
      <SessionApolloProvider>
        <RouterProvider router={router} />
      </SessionApolloProvider>
    </AuthProvider>
  )
}
