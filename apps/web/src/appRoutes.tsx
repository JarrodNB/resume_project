/**
 * Description: Route table for the web app (shared by the browser router and tests).
 * Index:
 *   - appRoutes: public auth pages, then signed-in pages inside AppLayout
 */
import { Navigate, type RouteObject } from 'react-router'
import { AppLayout } from '@/components/AppLayout'
import { RequireAuth, RequireSignedOut } from '@/features/auth/RequireAuth'
import { SignInPage } from '@/features/auth/SignInPage'
import { SignUpPage } from '@/features/auth/SignUpPage'
import { CareerLibraryPage } from '@/features/career-library/CareerLibraryPage'
import { ResumeImportTaskPage } from '@/features/resume-import/ResumeImportTaskPage'
import { ResumeUploadPage } from '@/features/resume-import/ResumeUploadPage'

export const appRoutes: RouteObject[] = [
  {
    element: <RequireSignedOut />,
    children: [
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/sign-up', element: <SignUpPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/library" replace /> },
          { path: '/library', element: <CareerLibraryPage /> },
          { path: '/import', element: <ResumeUploadPage /> },
          { path: '/import/:aiTaskId', element: <ResumeImportTaskPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]
