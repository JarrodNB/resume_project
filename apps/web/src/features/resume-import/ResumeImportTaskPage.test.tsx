/**
 * Description: The task page renders the right step for each task state, and importing the
 * review navigates to the career library with the added/merged counts.
 */
import type { MockLink } from '@apollo/client/testing'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { ImportSummaryNotice } from '@/features/career-library/ImportSummaryNotice'
import { buildParsedResume } from '@/test/parsedResumeFixture'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { IMPORT_PARSED_RESUME_MUTATION } from './resumeImportOperations'
import { ResumeImportTaskPage } from './ResumeImportTaskPage'

function aiTaskMock(task: Record<string, unknown>) {
  return {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } },
    result: {
      data: {
        aiTaskUpdated: {
          __typename: 'AiTask',
          id: 'task-1',
          taskType: 'PARSE_RESUME',
          status: 'QUEUED',
          result: null,
          input: {},
          pendingQuestions: [],
          errorMessage: null,
          acceptedAt: null,
          createdAt: '2026-10-01T00:00:00Z',
          job: null,
          ...task,
        },
      },
    },
  }
}

function renderTaskPage(mocks: MockLink.MockedResponse[]) {
  return renderPage({
    path: '/import/:aiTaskId',
    url: '/import/task-1',
    element: <ResumeImportTaskPage />,
    mocks,
    extraRoutes: [
      {
        path: '/library',
        element: (
          <>
            <p>Library page</p>
            <ImportSummaryNotice />
          </>
        ),
      },
    ],
  })
}

it('shows progress while the resume is being parsed', async () => {
  renderTaskPage([aiTaskMock({ status: 'QUEUED' })])
  expect(await screen.findByText('Reading your resume…')).toBeInTheDocument()
})

it('shows the error when parsing failed', async () => {
  renderTaskPage([aiTaskMock({ status: 'FAILED', errorMessage: 'The file has no readable text.' })])
  expect(await screen.findByText('The file has no readable text.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Try another file' })).toHaveAttribute('href', '/import')
})

it('says so when the parse was already imported', async () => {
  renderTaskPage([aiTaskMock({ status: 'COMPLETED', acceptedAt: '2026-10-01T00:01:00Z' })])
  expect(await screen.findByText('Already imported')).toBeInTheDocument()
})

it('explains when parsing completed without a reviewable resume', async () => {
  renderTaskPage([aiTaskMock({ status: 'COMPLETED', result: null })])
  expect(await screen.findByText("We couldn't prepare a resume to review. Please upload the file again.")).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Try another file' })).toHaveAttribute('href', '/import')
  expect(screen.queryByText('Reading your resume…')).not.toBeInTheDocument()
})

it('explains when parsing is waiting for input that this page cannot provide', async () => {
  renderTaskPage([aiTaskMock({ status: 'NEEDS_USER_INPUT' })])
  expect(await screen.findByText("We couldn't prepare a resume to review. Please upload the file again.")).toBeInTheDocument()
  expect(screen.queryByText('Reading your resume…')).not.toBeInTheDocument()
})

it('imports the reviewed resume and opens the career library', async () => {
  const parsedResume = buildParsedResume()
  const importMock = {
    request: { query: IMPORT_PARSED_RESUME_MUTATION, variables: { aiTaskId: 'task-1', parsedResume } },
    result: {
      data: {
        importParsedResume: {
          __typename: 'ImportParsedResumePayload',
          aiTask: {
            __typename: 'AiTask',
            id: 'task-1',
            acceptedAt: '2026-10-01T00:01:00Z',
            result: { parsed_resume: parsedResume, import_summary: { added: 2, merged: 3 } },
          },
          errors: [],
        },
      },
    },
  }
  const { router } = renderTaskPage([
    aiTaskMock({ status: 'COMPLETED', result: { parsed_resume: parsedResume } }),
    importMock,
  ])

  await userEvent.click(await screen.findByRole('button', { name: 'Save to career library' }))

  expect(await screen.findByText('Library page')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/library')
  expect(screen.getByText('2 entries added, 3 merged into existing entries.')).toBeInTheDocument()
})
