/** Remember the signed-in candidate's input choice without storing recognized answer text.
 * Streaming transcription is the default until the candidate picks another mode.
 */
import { useState } from 'react'
import { PRODUCT_NAME } from '@/lib/productName'
import type { TranscriptionMode } from './transcriptionCapture'

export function useTranscriptionPreference(ownerId: string): [TranscriptionMode, (mode: TranscriptionMode) => void] {
  const key = `${PRODUCT_NAME}:interview-transcription:${ownerId}`
  const [mode, setMode] = useState<TranscriptionMode>(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved === 'browser' || saved === 'recorded' ? saved : 'streaming'
    } catch { return 'streaming' }
  })
  return [mode, (next) => {
    setMode(next)
    try { localStorage.setItem(key, next) } catch { /* The choice still applies to this answer. */ }
  }]
}
