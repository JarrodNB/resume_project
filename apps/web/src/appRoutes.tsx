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
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage'
import { CareerLibraryPage } from '@/features/career-library/CareerLibraryPage'
import { AddJobFromTextPage } from '@/features/jobs/AddJobFromTextPage'
import { AddJobFromUrlPage } from '@/features/jobs/AddJobFromUrlPage'
import { JobDetailPage } from '@/features/jobs/JobDetailPage'
import { JobPasteTaskPage } from '@/features/jobs/JobPasteTaskPage'
import { JobScrapeTaskPage } from '@/features/jobs/JobScrapeTaskPage'
import { JobsPage } from '@/features/jobs/JobsPage'
import { ResumeImportTaskPage } from '@/features/resume-import/ResumeImportTaskPage'
import { ResumeUploadPage } from '@/features/resume-import/ResumeUploadPage'
import { ResumePage } from '@/features/resumes/ResumePage'
import { ResumesPage } from '@/features/resumes/ResumesPage'
import { InterviewPrepPage } from '@/features/interview-prep/InterviewPrepPage'
import { InterviewSetPage } from '@/features/interview-prep/InterviewSetPage'
import { TailorResumePage } from '@/features/resume-tailoring/TailorResumePage'

export const appRoutes: RouteObject[] = [
  { path: '/verify-email', element: <VerifyEmailPage /> },
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
          { path: '/jobs', element: <JobsPage /> },
          { path: '/jobs/new', element: <AddJobFromUrlPage /> },
          { path: '/jobs/new/:aiTaskId', element: <JobScrapeTaskPage /> },
          { path: '/jobs/paste', element: <AddJobFromTextPage /> },
          { path: '/jobs/paste/:aiTaskId', element: <JobPasteTaskPage /> },
          { path: '/jobs/:id/tailor', element: <TailorResumePage /> },
          { path: '/jobs/:id', element: <JobDetailPage /> },
          { path: '/interview-prep', element: <InterviewPrepPage /> },
          { path: '/interview-prep/:id', element: <InterviewSetPage /> },
          { path: '/resumes', element: <ResumesPage /> },
          { path: '/resumes/:id', element: <ResumePage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]
