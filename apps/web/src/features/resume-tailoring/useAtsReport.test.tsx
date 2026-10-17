/** Delayed query and mutation responses must not undo a newer visible assessment. */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AtsReportFieldsFragment } from '@/graphql/generated/graphql'
import { useAtsReport } from './useAtsReport'

const apollo = vi.hoisted(() => ({
  query: { data: undefined as unknown, error: undefined, refetch: vi.fn() },
  mutate: vi.fn(),
}))
vi.mock('@apollo/client/react', () => ({
  useQuery: () => apollo.query,
  useSubscription: () => ({ error: undefined }),
  useMutation: () => [apollo.mutate],
}))

function report(overrides: Record<string, unknown> = {}): AtsReportFieldsFragment {
  const category = { __typename: 'AtsCategory', status: 'queued', score: null, reason: null, assessments: [], deductions: [] }
  return {
    __typename: 'AtsReport', id: 'run', runId: 'run', contentFingerprint: 'content',
    jobFingerprint: 'job', rubricVersion: 'ats-v1', createdAt: '2026-10-17T00:00:00.000000Z',
    stateVersion: '0', observedAt: '2026-10-17T00:00:01.000000Z', outdated: false, overallScore: null,
    jobAlignment: category, contentQuality: category, pdfReadability: category, ...overrides,
  } as AtsReportFieldsFragment
}
beforeEach(() => { apollo.query.data = undefined; vi.clearAllMocks() })

it('retains a completed same-run report when older query and export responses arrive later', () => {
  const queued = report()
  const completed = report({ stateVersion: '1', contentQuality: { ...queued.contentQuality, status: 'completed', score: 90 } })
  const hook = renderHook(() => useAtsReport('resume'))
  act(() => { hook.result.current.receive(completed) })
  act(() => { hook.result.current.receive(queued) })
  expect(hook.result.current.report?.contentQuality.status).toBe('completed')
  apollo.query.data = { resume: { atsReport: queued } }
  hook.rerender()
  expect(hook.result.current.report?.contentQuality.status).toBe('completed')
})

it('accepts later live job invalidation without a report row update', () => {
  const current = report({ stateVersion: '2', observedAt: '2026-10-17T00:00:02.000000Z' })
  const outdated = report({ stateVersion: '2', observedAt: '2026-10-17T00:00:03.000000Z', outdated: true,
    jobAlignment: { ...current.jobAlignment, status: 'outdated' } })
  const hook = renderHook(() => useAtsReport('resume'))
  act(() => { hook.result.current.receive(current); hook.result.current.receive(outdated) })
  expect(hook.result.current.report?.outdated).toBe(true)
  act(() => { hook.result.current.receive(current) })
  expect(hook.result.current.report?.outdated).toBe(true)
})

it('prioritizes a newer run over a higher revision on the previous run', () => {
  const hook = renderHook(() => useAtsReport('resume'))
  act(() => { hook.result.current.receive(report({ stateVersion: '50' })) })
  act(() => { hook.result.current.receive(report({ id: 'next', runId: 'next', createdAt: '2026-10-17T00:00:04.000000Z' })) })
  act(() => { hook.result.current.receive(report({ stateVersion: '51' })) })
  expect(hook.result.current.report?.runId).toBe('next')
})

it('compares revisions numerically and breaks equal run-time ties by server id ordering', () => {
  const hook = renderHook(() => useAtsReport('resume'))
  act(() => { hook.result.current.receive(report({ stateVersion: '10' })) })
  act(() => { hook.result.current.receive(report({ stateVersion: '9' })) })
  expect(hook.result.current.report?.stateVersion).toBe('10')
  act(() => { hook.result.current.receive(report({ runId: 'z-new', id: 'z-new', stateVersion: '0' })) })
  act(() => { hook.result.current.receive(report({ runId: 'a-old', id: 'a-old', stateVersion: '50' })) })
  expect(hook.result.current.report?.runId).toBe('z-new')
})
