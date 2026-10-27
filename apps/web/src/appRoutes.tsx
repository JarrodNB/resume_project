/**
 * Description: Route table for the web app (shared by the browser router and tests).
 * Index:
 *   - appRoutes: public auth pages, then signed-in pages inside AppLayout grouped as Jobs, Library, and Practice,
 *     plus redirects that keep old bookmarks (`/job-board`, `/import`, `/interview-prep`, `/interviews`) working
 */
import { Navigate, type RouteObject } from 'react-router'
import { AppLayout } from '@/components/AppLayout'
import { RedirectToPath } from '@/components/RedirectToPath'
import { RequireAuth, RequireSignedOut } from '@/features/auth/RequireAuth'
import { SignInPage } from '@/features/auth/SignInPage'
import { SignUpPage } from '@/features/auth/SignUpPage'
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { PasswordUpdatePage, PasswordUpdatedPage } from '@/features/auth/PasswordUpdatePage'
import { CareerLibraryPage } from '@/features/career-library/CareerLibraryPage'
import { AddJobFromTextPage } from '@/features/jobs/AddJobFromTextPage'
import { AddJobFromUrlPage } from '@/features/jobs/AddJobFromUrlPage'
import { JobDetailPage } from '@/features/jobs/JobDetailPage'
import { JobPasteTaskPage } from '@/features/jobs/JobPasteTaskPage'
import { JobScrapeTaskPage } from '@/features/jobs/JobScrapeTaskPage'
import { JobBoardPage } from '@/features/job-board/JobBoardPage'
import { JobsPage } from '@/features/jobs/JobsPage'
import { ResumeImportTaskPage } from '@/features/resume-import/ResumeImportTaskPage'
import { ResumeUploadPage } from '@/features/resume-import/ResumeUploadPage'
import { ResumePage } from '@/features/resumes/ResumePage'
import { ResumesPage } from '@/features/resumes/ResumesPage'
import { InterviewPrepPage } from '@/features/interview-prep/InterviewPrepPage'
import { InterviewSetPage } from '@/features/interview-prep/InterviewSetPage'
import { InterviewPage } from '@/features/interviews/InterviewPage'
import { JobInterviewSetupPage } from '@/features/interviews/JobInterviewSetupPage'
import { TailorResumePage } from '@/features/resume-tailoring/TailorResumePage'

export const appRoutes: RouteObject[] = [
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <PasswordUpdatePage /> },
  { path: '/password-updated', element: <PasswordUpdatedPage /> },
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
          { path: '/account/security', element: <PasswordUpdatePage change /> },
          { index: true, element: <Navigate to="/jobs" replace /> },
          { path: '/library', element: <CareerLibraryPage /> },
          { path: '/library/import', element: <ResumeUploadPage /> },
          { path: '/library/import/:aiTaskId', element: <ResumeImportTaskPage /> },
          { path: '/jobs', element: <JobsPage /> },
          { path: '/jobs/find', element: <JobBoardPage /> },
          { path: '/jobs/new', element: <AddJobFromUrlPage /> },
          { path: '/jobs/new/:aiTaskId', element: <JobScrapeTaskPage /> },
          { path: '/jobs/paste', element: <AddJobFromTextPage /> },
          { path: '/jobs/paste/:aiTaskId', element: <JobPasteTaskPage /> },
          { path: '/jobs/:id/tailor', element: <TailorResumePage /> },
          { path: '/jobs/:jobId/interview', element: <JobInterviewSetupPage /> },
          { path: '/jobs/:id', element: <JobDetailPage /> },
          { path: '/practice', element: <Navigate to="/practice/questions" replace /> },
          { path: '/practice/questions', element: <InterviewPrepPage /> },
          { path: '/practice/questions/:id', element: <InterviewSetPage /> },
          { path: '/practice/interviews/:id?', element: <InterviewPage /> },
          { path: '/resumes', element: <ResumesPage /> },
          { path: '/resumes/:id', element: <ResumePage /> },
          { path: '/job-board', element: <RedirectToPath to="/jobs/find" /> },
          { path: '/import/:aiTaskId?', element: <RedirectToPath to="/library/import/:aiTaskId?" /> },
          { path: '/interview-prep/:id?', element: <RedirectToPath to="/practice/questions/:id?" /> },
          { path: '/interviews/demo/:id?', element: <RedirectToPath to="/practice/interviews/:id?" /> },
          { path: '/interviews/:id?', element: <RedirectToPath to="/practice/interviews/:id?" /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]
