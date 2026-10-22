/** Remember the signed-in candidate's input choice without storing recognized answer text. */
import { useState } from 'react'
import { PRODUCT_NAME } from '@/lib/productName'
import type { TranscriptionMode } from './transcriptionCapture'

export function useTranscriptionPreference(ownerId: string): [TranscriptionMode, (mode: TranscriptionMode) => void] {
  const key = `${PRODUCT_NAME}:interview-transcription:${ownerId}`
  const [mode, setMode] = useState<TranscriptionMode>(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved === 'streaming' || saved === 'recorded' ? saved : 'browser'
    } catch { return 'browser' }
  })
  return [mode, (next) => {
    setMode(next)
    try { localStorage.setItem(key, next) } catch { /* The choice still applies to this answer. */ }
  }]
}
