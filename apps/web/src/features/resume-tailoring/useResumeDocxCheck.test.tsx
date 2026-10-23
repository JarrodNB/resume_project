/** Check the exact Word bytes and ignore results from outdated snapshots. */
import { webcrypto } from 'node:crypto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useResumeDocxCheck } from './useResumeDocxCheck'
import { generateResumeDocx } from './resumeDocxDocument'
const network = vi.hoisted(() => ({ mutate: vi.fn(), query: vi.fn() }))
vi.mock('@apollo/client/react', () => ({ useApolloClient: () => network }))
vi.mock('./resumeDocxDocument', () => ({ generateResumeDocx: vi.fn() }))
const snapshot = JSON.stringify({ name: 'Ada', contactLine: '', links: [], blocks: [] })
const blob = new Blob(['exact Word bytes'])
const digest = 'ab'.repeat(32)
const completed = { id: 'check-1', status: 'completed', contentDigest: digest, pageCount: 3, expiresAt: new Date(Date.now() + 60_000).toISOString() }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(generateResumeDocx).mockResolvedValue(blob)
  Object.defineProperty(blob, 'arrayBuffer', { configurable: true, value: async () => new ArrayBuffer(2) })
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(171).buffer) } })
  network.mutate.mockResolvedValue({ data: { startResumeDocxPageCheck: { check: completed, errors: [] } } })
})
it('uploads and retains the exact generated Blob, and reuses it for the current snapshot', async () => {
  const { result } = renderHook(() => useResumeDocxCheck(snapshot))
  let downloaded: Blob | undefined
  await act(async () => { downloaded = await result.current.prepare() })
  await waitFor(() => expect(result.current.state.status).toBe('completed'))
  expect(downloaded).toBe(blob)
  expect(network.mutate.mock.calls[0][0].variables.file).toBe(blob)
  expect(network.mutate.mock.calls[0][0].variables).not.toHaveProperty('resumeId')
  await act(async () => { expect(await result.current.prepare()).toBe(blob) })
  expect(generateResumeDocx).toHaveBeenCalledTimes(1)
  expect(network.mutate).toHaveBeenCalledTimes(1)
})

it('keeps downloads available while pending and polls until a separate DOCX count arrives', async () => {
  network.mutate.mockResolvedValue({ data: { startResumeDocxPageCheck: { check: { ...completed, status: 'queued', pageCount: null }, errors: [] } } })
  network.query.mockResolvedValue({ data: { resumeDocxPageCheck: completed } })
  const { result } = renderHook(() => useResumeDocxCheck(snapshot, 'resume-1'))
  await act(async () => { expect(await result.current.prepare()).toBe(blob) })
  await waitFor(() => expect(result.current.state.status).toBe('checking'))
  expect(network.mutate.mock.calls[0][0].variables.resumeId).toBe('resume-1')
  await act(async () => { expect(await result.current.prepare()).toBe(blob) })
  await waitFor(() => expect(result.current.state.pageCount).toBe(3), { timeout: 2500 })
  expect(network.query.mock.calls[0][0].fetchPolicy).toBe('no-cache')
})

it('invalidates counts immediately on edits and ignores late uploads', async () => {
  let finish!: (value: unknown) => void
  network.mutate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const view = renderHook(({ content }) => useResumeDocxCheck(content), { initialProps: { content: snapshot } })
  await act(async () => { await view.result.current.prepare() })
  await waitFor(() => expect(network.mutate).toHaveBeenCalledTimes(1))
  view.rerender({ content: snapshot.replace('Ada', 'Grace') })
  expect(view.result.current.state.status).toBe('idle')
  await act(async () => finish({ data: { startResumeDocxPageCheck: { check: completed, errors: [] } } }))
  expect(view.result.current.state.status).toBe('idle')
  await act(async () => { await view.result.current.prepare() })
  await waitFor(() => expect(view.result.current.state.status).toBe('completed'))
  expect(generateResumeDocx).toHaveBeenCalledTimes(2)
})

it.each(['mismatch', 'expired', 'failed', 'network'])('retains the same downloadable bytes on %s, with explicit retry', async (failure) => {
  if (failure === 'network') network.mutate.mockRejectedValueOnce(new Error('offline'))
  else network.mutate.mockResolvedValueOnce({ data: { startResumeDocxPageCheck: { check: {
    ...completed,
    ...(failure === 'mismatch' ? { contentDigest: 'other' } : {}),
    ...(failure === 'expired' ? { expiresAt: '2000-01-01T00:00:00Z' } : {}),
    ...(failure === 'failed' ? { status: 'failed', pageCount: null } : {}),
  }, errors: [] } } })
  const { result } = renderHook(() => useResumeDocxCheck(snapshot))
  await act(async () => { expect(await result.current.prepare()).toBe(blob) })
  await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
  expect(result.current.state.pageCount).toBeUndefined()
  await act(async () => { expect(await result.current.prepare(true)).toBe(blob) })
  await waitFor(() => expect(result.current.state.status).toBe('completed'))
  expect(generateResumeDocx).toHaveBeenCalledTimes(1)
  expect(network.mutate.mock.calls[1][0].variables.retryFailed).toBe(true)
})

it('stops irrelevant polling when unmounted', async () => {
  network.mutate.mockResolvedValue({ data: { startResumeDocxPageCheck: { check: { ...completed, status: 'running' }, errors: [] } } })
  const { result, unmount } = renderHook(() => useResumeDocxCheck(snapshot))
  await act(async () => { await result.current.prepare() })
  await waitFor(() => expect(result.current.state.status).toBe('checking'))
  unmount()
  await new Promise((resolve) => setTimeout(resolve, 1600))
  expect(network.query).not.toHaveBeenCalled()
})

it('does not restore a discarded count when content is changed then reverted', async () => {
  const view = renderHook(({ content }) => useResumeDocxCheck(content), { initialProps: { content: snapshot } })
  await act(async () => { await view.result.current.prepare() })
  await waitFor(() => expect(view.result.current.state.status).toBe('completed'))
  view.rerender({ content: snapshot.replace('Ada', 'Grace') })
  view.rerender({ content: snapshot })
  expect(view.result.current.state.status).toBe('idle')
})

it('makes an expired completed count unavailable and retries the same bytes', async () => {
  network.mutate.mockResolvedValueOnce({ data: { startResumeDocxPageCheck: { check: { ...completed, expiresAt: new Date(Date.now() + 100).toISOString() }, errors: [] } } })
  const { result } = renderHook(() => useResumeDocxCheck(snapshot))
  await act(async () => { await result.current.prepare() })
  await waitFor(() => expect(result.current.state.status).toBe('completed'))
  await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
  await act(async () => { expect(await result.current.prepare(true)).toBe(blob) })
  await waitFor(() => expect(result.current.state.status).toBe('completed'))
  expect(generateResumeDocx).toHaveBeenCalledTimes(1)
})

it('retains downloads when hashing or polling fails and allows regeneration after rendering fails', async () => {
  vi.mocked(generateResumeDocx).mockRejectedValueOnce(new Error('render unavailable'))
  const { result } = renderHook(() => useResumeDocxCheck(snapshot))
  await act(async () => { await expect(result.current.prepare()).rejects.toThrow('render unavailable') })
  expect(result.current.state.status).toBe('unavailable')
  vi.mocked(crypto.subtle.digest).mockRejectedValueOnce(new Error('hash unavailable'))
  await act(async () => { expect(await result.current.prepare(true)).toBe(blob) })
  await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
  expect(network.mutate).not.toHaveBeenCalled()
  network.mutate.mockResolvedValueOnce({ data: { startResumeDocxPageCheck: { check: { ...completed, status: 'queued' }, errors: [] } } })
  network.query.mockRejectedValueOnce(new Error('poll failed'))
  await act(async () => { expect(await result.current.prepare(true)).toBe(blob) })
  await waitFor(() => expect(result.current.state.status).toBe('unavailable'), { timeout: 2500 })
  expect(generateResumeDocx).toHaveBeenCalledTimes(2)
})


it('hashes the exact export bytes with SHA-256 before uploading them', async () => {
  vi.stubGlobal('crypto', webcrypto)
  Object.defineProperty(blob, 'arrayBuffer', { configurable: true, value: async () => new TextEncoder().encode('exact Word bytes').buffer })
  const actualDigest = '3ad29b1f6be13c041c14ff5ed4cbd59f88b616ee7234926c7f6ab8ccd952b7af'
  network.mutate.mockResolvedValueOnce({ data: { startResumeDocxPageCheck: { check: { ...completed, contentDigest: actualDigest }, errors: [] } } })
  const { result } = renderHook(() => useResumeDocxCheck(snapshot))
  await act(async () => { expect(await result.current.prepare()).toBe(blob) })
  await waitFor(() => expect(result.current.state.status).toBe('completed'))
  expect(network.mutate.mock.calls[0][0].variables).toMatchObject({ file: blob, contentDigest: actualDigest })
})
