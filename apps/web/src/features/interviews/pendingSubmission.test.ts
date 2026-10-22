/** Reload recovery keeps only an owner-scoped submission identity, never recording bytes or grants. */
import { describe, expect, it } from 'vitest'
import { loadPendingSubmission, savePendingSubmission, clearPendingSubmission } from './pendingSubmission'

const pending = { questionId: 'question', recordingId: 'recording', expectedRevision: 0, submissionKey: 'stable-key' }
describe('pending interview submission', () => {
  it('restores the same identity only for the same owner and interview', () => {
    savePendingSubmission('owner', 'session', pending)
    expect(loadPendingSubmission('owner', 'session')).toEqual(pending)
    expect(loadPendingSubmission('other-owner', 'session')).toBeNull()
    expect(loadPendingSubmission('owner', 'other-session')).toBeNull()
    clearPendingSubmission('owner', 'session')
    expect(loadPendingSubmission('owner', 'session')).toBeNull()
  })
  it('ignores malformed storage and tolerates unavailable browser storage', () => {
    savePendingSubmission('owner', 'session', pending)
    localStorage.setItem(localStorage.key(0)!, '{bad')
    expect(loadPendingSubmission('owner', 'session')).toBeNull()
  })
})


it('restores a digest-only typed identity while rejecting missing audio from older modes', () => {
  const typed = { questionId: 'question', expectedRevision: 0, submissionKey: 'typed', transcriptionMode: 'typed' as const, transcriptDigest: 'a'.repeat(64) }
  savePendingSubmission('owner', 'session', typed)
  expect(loadPendingSubmission('owner', 'session')).toEqual(typed)
  savePendingSubmission('owner', 'session', { ...typed, transcriptionMode: 'browser' })
  expect(loadPendingSubmission('owner', 'session')).toBeNull()
})
