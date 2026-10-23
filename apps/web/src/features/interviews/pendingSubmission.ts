/** Remember a submission identity across reloads without storing audio, dialogue, or signed URLs.
 * Keys include the signed-in owner because browser storage survives account changes.
 */
import { PRODUCT_NAME } from '@/lib/productName'

export interface PendingSubmission {
  questionId: string
  recordingId?: string
  expectedRevision: number
  submissionKey: string
  transcriptionMode?: 'browser' | 'streaming' | 'recorded' | 'typed'
  transcriptDigest?: string
}
function storageKey(ownerId: string, interviewId: string) { return `${PRODUCT_NAME}:interview-submit:${ownerId}:${interviewId}` }

export function loadPendingSubmission(ownerId: string, interviewId: string): PendingSubmission | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey(ownerId, interviewId)) ?? 'null')
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Partial<PendingSubmission>
    if (typeof value.questionId !== 'string' || (typeof value.recordingId !== 'string' && !(value.transcriptionMode === 'typed' && value.recordingId === undefined)) ||
      typeof value.submissionKey !== 'string' || !Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) return null
    if (value.transcriptionMode !== undefined && !['browser', 'streaming', 'recorded', 'typed'].includes(value.transcriptionMode)) return null
    if (value.transcriptDigest !== undefined && (typeof value.transcriptDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.transcriptDigest))) return null
    if (value.transcriptionMode === 'typed' && !value.transcriptDigest) return null
    return { ...(value.recordingId ? { recordingId: value.recordingId } : {}), ...(value.transcriptionMode ? { transcriptionMode: value.transcriptionMode } : {}), ...(value.transcriptDigest ? { transcriptDigest: value.transcriptDigest } : {}), questionId: value.questionId, expectedRevision: Number(value.expectedRevision), submissionKey: value.submissionKey }
  } catch { return null }
}
/** Returns false when reload-safe persistence is unavailable; do not submit in that case. */
export function savePendingSubmission(ownerId: string, interviewId: string, value: PendingSubmission): boolean {
  try { localStorage.setItem(storageKey(ownerId, interviewId), JSON.stringify(value)); return true } catch { return false }
}
export function clearPendingSubmission(ownerId: string, interviewId: string) {
  try { localStorage.removeItem(storageKey(ownerId, interviewId)) } catch { /* Storage may be disabled. */ }
}
