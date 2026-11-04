/**
 * Description: The gap analysis card starts a comparison, follows a running one, and shows failures
 * and completed results (requirement groups, evidence, details for the resume, and dismissing).
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { JOB_QUERY } from '@/features/jobs/jobsOperations'
import { setSectionOpen } from '@/lib/openSections'
import { renderPage } from '@/test/renderPage'
import { useGapAnalysis } from './useGapAnalysis'
import { GapAnalysisCard, type GapAnalysisTask } from './GapAnalysisCard'
import { ANALYZE_JOB_GAPS_MUTATION, SAVE_GAP_RESPONSE_MUTATION, SET_GAP_DISMISSAL_MUTATION } from './gapAnalysisOperations'

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
          input: {},
          pendingQuestions: [],
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
          aiTask: payload.aiTask && {
            __typename: 'AiTask',
            result: null,
            errorMessage: null,
            createdAt: '2026-10-01T00:00:00Z',
            ...payload.aiTask,
          },
          errors: payload.errors,
        },
      },
    },
  }
}

/** Opens one requirement row so a test can read its evidence and response form. */
function openGap(requirement: string) {
  setSectionOpen(`job.job-1.gap.${requirement}`, true)
}

function TestCard({ latestGapAnalysis, dismissedRequirements = [] }: { latestGapAnalysis: GapAnalysisTask | null; dismissedRequirements?: string[] }) {
  const comparison = useGapAnalysis('job-1', latestGapAnalysis)
  return <GapAnalysisCard jobId="job-1" comparison={comparison} gapResponses={[]} dismissedRequirements={dismissedRequirements} />
}

function renderCard(
  latestGapAnalysis: GapAnalysisTask | null,
  mocks: ReturnType<typeof startMock | typeof aiTaskUpdateMock>[] = [],
) {
  return renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <TestCard latestGapAnalysis={latestGapAnalysis} />,
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

it('leaves the profile summary out of a requirement evidence list', () => {
  const biography = 'Full-stack software engineer with 7+ years building a fintech platform.'
  openGap('A degree in computer science')
  renderCard(
    task({
      result: {
        gap_analysis: {
          summary: 'You match the degree requirement.',
          assessments: [
            {
              kind: 'required',
              requirement: 'A degree in computer science',
              verdict: 'met',
              explanation: 'You hold a Bachelor of Science in Software Development.',
              evidence: [
                { kind: 'education', id: 'education-1', text: 'BSc, Software Development, Georgia Gwinnett College', context: null },
                { kind: 'summary', id: null, text: biography, context: null },
              ],
            },
          ],
        },
      },
    }),
  )

  expect(screen.getByText('BSc, Software Development, Georgia Gwinnett College')).toBeInTheDocument()
  expect(screen.queryByText(biography)).not.toBeInTheDocument()
})

it('sorts requirements into groups, with what needs the user first', () => {
  openGap('5+ years of Python')
  openGap('Kubernetes')
  renderCard(task({ result: COMPLETED_RESULT }))

  expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Gaps to fill1 gap', 'Met1 met', 'Nice to have'])
  const met = screen.getByText('5+ years of Python').closest('li') as HTMLElement
  expect(within(met).getByText('Met')).toBeInTheDocument()
  expect(within(met).getByText(/Built Python APIs/)).toBeInTheDocument()
  expect(within(met).queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText('Partly met')).toBeInTheDocument()
  expect(screen.getByText(/Compared on/)).toBeInTheDocument()
})

it('shows a gap open, asking for details the resume can use', () => {
  renderCard(task({ result: COMPLETED_RESULT }))

  const gap = screen.getByText('Go').closest('li') as HTMLElement
  expect(within(gap).getByText('Nothing in your library mentions Go.')).toBeVisible()
  expect(within(gap).getByRole('textbox', { name: 'Details for your resume' })).toBeVisible()
  expect(within(gap).getByRole('checkbox', { name: 'Add to career library' })).toBeInTheDocument()
})

it('asks for details on a partial match only when the user chooses to add them', async () => {
  const user = userEvent.setup()
  const assessments = [{ kind: 'required', requirement: 'SQL', verdict: 'partial', explanation: 'Some SQL.', evidence: [] }]
  renderCard(task({ result: { gap_analysis: { summary: '', assessments } } }))

  const row = screen.getByText('SQL').closest('li') as HTMLElement
  expect(within(row).queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(within(row).getByRole('button', { name: 'Add details for SQL' }))
  expect(within(row).getByRole('textbox')).toBeVisible()
})

it('keeps an unsaved answer when a collapsed requirement is closed', async () => {
  openGap('Kubernetes')
  const user = userEvent.setup()
  renderCard(task({ result: COMPLETED_RESULT }))

  const row = screen.getByText('Kubernetes').closest('li') as HTMLElement
  await user.type(within(row).getByRole('textbox'), 'Ran the Acme cluster')
  await user.click(within(row).getByRole('button', { name: /Kubernetes/ }))
  expect(within(row).queryByRole('textbox')).not.toBeInTheDocument()

  await user.click(within(row).getByRole('button', { name: /Kubernetes/ }))
  expect(within(row).getByRole('textbox')).toHaveValue('Ran the Acme cluster')
})

it('only offers to dismiss while the box is empty', async () => {
  const user = userEvent.setup()
  renderCard(task({ result: COMPLETED_RESULT }))

  const gap = screen.getByText('Go').closest('li') as HTMLElement
  expect(within(gap).getByRole('button', { name: 'Dismiss Go' })).toBeVisible()
  await user.type(within(gap).getByRole('textbox'), 'Used it at Acme')
  expect(within(gap).queryByRole('button', { name: 'Dismiss Go' })).not.toBeInTheDocument()
})

it('moves a dismissed requirement out of the gaps and offers Restore', () => {
  renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <TestCard latestGapAnalysis={task({ result: COMPLETED_RESULT })} dismissedRequirements={['Go']} />,
  })

  expect(screen.queryByRole('heading', { name: /Gaps to fill/ })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Dismissed' })).toBeInTheDocument()
  const row = screen.getByText('Go').closest('li') as HTMLElement
  expect(within(row).queryByRole('textbox')).not.toBeInTheDocument()
  expect(within(row).getByRole('button', { name: 'Restore Go' })).toBeVisible()
})

it('keeps a met requirement out of Dismissed when a new comparison finds evidence', () => {
  renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <TestCard latestGapAnalysis={task({ result: COMPLETED_RESULT })} dismissedRequirements={['5+ years of Python']} />,
  })

  expect(screen.queryByRole('heading', { name: 'Dismissed' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /^Met/ })).toBeInTheDocument()
})

it('shows why a dismissal failed and leaves the gap in place', async () => {
  const user = userEvent.setup()
  renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <TestCard latestGapAnalysis={task({ result: COMPLETED_RESULT })} />,
    mocks: [{
      request: { query: SET_GAP_DISMISSAL_MUTATION, variables: { jobId: 'job-1', requirement: 'Go', dismissed: true } },
      result: { data: { setGapDismissal: { __typename: 'SetGapDismissalPayload', job: null, errors: ['Clear your details for this requirement before dismissing it'] } } },
    }],
  })

  await user.click(screen.getByRole('button', { name: 'Dismiss Go' }))

  expect(await screen.findByText('Clear your details for this requirement before dismissing it')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /Gaps to fill/ })).toBeInTheDocument()
})

it('saves a response and can add it to the career library', async () => {
  const user = userEvent.setup()
  renderPage({
    path: '/jobs/:id',
    url: '/jobs/job-1',
    element: <TestCard latestGapAnalysis={task({ result: COMPLETED_RESULT })} />,
    mocks: [
      {
        request: {
          query: SAVE_GAP_RESPONSE_MUTATION,
          variables: { jobId: 'job-1', requirement: 'Go', body: 'Used it at Acme', addToLibrary: true },
        },
        result: {
          data: {
            saveGapResponse: {
              __typename: 'SaveGapResponsePayload',
              errors: [],
              jobGapResponse: {
                __typename: 'JobGapResponse',
                id: 'response-1',
                requirement: 'Go',
                body: 'Used it at Acme',
                careerContext: { __typename: 'CareerContext', id: 'context-1' },
              },
            },
          },
        },
      },
      {
        request: { query: JOB_QUERY, variables: { id: 'job-1' } },
        result: {
          data: {
            job: {
              __typename: 'Job',
              id: 'job-1',
              title: 'Engineer',
              company: 'Acme',
              location: null,
              stage: 'UNAPPLIED',
              url: null,
              description: null,
              requirements: ['Go'],
              responsibilities: [],
              niceToHaves: [],
              notes: null,
              appliedAt: null,
              dismissedRequirements: [],
              gapResponses: [
                {
                  __typename: 'JobGapResponse',
                  id: 'response-1',
                  requirement: 'Go',
                  body: 'Used it at Acme',
                  careerContext: { __typename: 'CareerContext', id: 'context-1' },
                },
              ],
              latestGapAnalysis: null,
              resume: null,
            },
          },
        },
      },
    ],
  })

  const gap = screen.getByText('Go').closest('li') as HTMLElement
  await user.type(within(gap).getByRole('textbox'), 'Used it at Acme')
  await user.click(within(gap).getByRole('checkbox', { name: 'Add to career library' }))
  await user.click(within(gap).getByRole('button', { name: 'Save' }))

  expect(await within(gap).findByText('Saved on this job. Resume drafts for this job can use it.')).toBeInTheDocument()
})
