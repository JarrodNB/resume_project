/**
 * Description: The gap analysis card starts a comparison, follows a running one, and shows failures
 * and completed results (verdicts, evidence, and the nice-to-have section).
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { renderPage } from '@/test/renderPage'
import { GapAnalysisCard, type GapAnalysisTask } from './GapAnalysisCard'
import { ANALYZE_JOB_GAPS_MUTATION } from './gapAnalysisOperations'

const COMPLETED_RESULT = {
  gap_analysis: {
    summary: 'You match most of the core requirements.',
    assessments: [
      {
        kind: 'required',
        requirement: '5+ years of Python',
        verdict: 'met',
        explanation: 'Your current role has been Python work since 2018.',
        evidence: [{ kind: 'highlight', id: 'highlight-1', text: 'Built Python APIs', context: 'Senior Engineer at Now Co' }],
      },
      {
        kind: 'required',
        requirement: 'Go',
        verdict: 'missing',
        explanation: 'Nothing in your library mentions Go.',
        evidence: [],
      },
      {
        kind: 'nice_to_have',
        requirement: 'Kubernetes',
        verdict: 'partial',
        explanation: 'You built a deploy bot but no Kubernetes work.',
        evidence: [{ kind: 'project', id: 'project-1', text: 'Deploy bot', context: null }],
      },
    ],
  },
}

function task(fields: Partial<GapAnalysisTask>): GapAnalysisTask {
  return { id: 'task-1', status: 'COMPLETED', result: null, errorMessage: null, createdAt: '2026-10-01T00:00:00Z', ...fields }
}

function aiTaskUpdateMock(id: string, fields: Record<string, unknown>) {
  return {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id } },
    result: {
      data: {
        aiTaskUpdated: {
          __typename: 'AiTask',
          id,
          taskType: 'ANALYZE_GAPS',
          status: 'QUEUED',
          result: null,
          errorMessage: null,
          acceptedAt: null,
          createdAt: '2026-10-01T00:00:00Z',
          job: null,
          ...fields,
        },
      },
    },
  }
}

function startMock(payload: { aiTask: { id: string; status: string } | null; errors: string[] }) {
  return {
    request: { query: ANALYZE_JOB_GAPS_MUTATION, variables: { jobId: 'job-1' } },
    result: {
      data: {
        analyzeJobGaps: {
          __typename: 'AnalyzeJobGapsPayload',
          aiTask: payload.aiTask && { __typename: 'AiTask', ...payload.aiTask },
          errors: payload.errors,
        },
      },
    },
  }
}

function renderCard(latestGapAnalysis: GapAnalysisTask | null, mocks: ReturnType<typeof startMock | typeof aiTaskUpdateMock>[] = []) {
  return renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <GapAnalysisCard jobId="job-1" latestGapAnalysis={latestGapAnalysis} />,
    mocks,
  })
}

it('offers to run the first comparison', () => {
  renderCard(null)
  expect(screen.getByRole('button', { name: 'Compare with my career library' })).toBeInTheDocument()
})

it('starts a comparison and shows its result when it completes', async () => {
  renderCard(null, [
    startMock({ aiTask: { id: 'task-2', status: 'QUEUED' }, errors: [] }),
    aiTaskUpdateMock('task-2', { status: 'COMPLETED', result: COMPLETED_RESULT }),
  ])

  await userEvent.click(screen.getByRole('button', { name: 'Compare with my career library' }))

  expect(await screen.findByText('You match most of the core requirements.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Compare again' })).toBeInTheDocument()
})

it('shows why the comparison could not start', async () => {
  renderCard(null, [startMock({ aiTask: null, errors: ['Add something to your career library first.'] })])

  await userEvent.click(screen.getByRole('button', { name: 'Compare with my career library' }))

  expect(await screen.findByText('Add something to your career library first.')).toBeInTheDocument()
})

it('follows a comparison that is still running', async () => {
  renderCard(task({ status: 'QUEUED' }), [aiTaskUpdateMock('task-1', { status: 'QUEUED' })])
  expect(await screen.findByText('Comparing this job with your career library…')).toBeInTheDocument()
})

it('shows a failed comparison with a retry button', () => {
  renderCard(task({ status: 'FAILED', errorMessage: 'This job no longer exists.' }))

  expect(screen.getByText('This job no longer exists.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})

it('shows verdicts, evidence, and the nice-to-have section', () => {
  renderCard(task({ result: COMPLETED_RESULT }))

  expect(screen.getByText('Requirements: 1 met · 0 partly met · 1 gap')).toBeInTheDocument()
  const pythonItem = screen.getByText('5+ years of Python').closest('li')
  expect(pythonItem).not.toBeNull()
  expect(within(pythonItem as HTMLElement).getByText('Met')).toBeInTheDocument()
  expect(within(pythonItem as HTMLElement).getByText(/Built Python APIs/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Nice to have' })).toBeInTheDocument()
  expect(screen.getByText('Partly met')).toBeInTheDocument()
  expect(screen.getByText(/Compared on/)).toBeInTheDocument()
})
