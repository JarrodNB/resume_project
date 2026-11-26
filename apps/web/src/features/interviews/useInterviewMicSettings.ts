/** Remember microphone preferences for this account without saving any answer content.
 * Hands-free mode needs automatic capture, so turning it on turns automatic capture on, and
 * turning automatic capture off turns hands-free off. Older saved values load with the defaults.
 */
import { useState } from 'react'
import { PRODUCT_NAME } from '@/lib/productName'

/** How long the candidate must stay quiet before hands-free mode ends an answer. */
export const SILENCE_SECONDS_OPTIONS = [1.5, 2.5, 4] as const
export const DEFAULT_SILENCE_SECONDS = 2.5

interface MicSettings { automatic: boolean; seconds: number; handsFree: boolean; silenceSeconds: number }

function loadMicSettings(key: string): MicSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
    const automatic = saved.automatic === true
    return {
      automatic,
      seconds: automatic ? ([0, 3, 5, 10].includes(saved.seconds) ? Number(saved.seconds) : 5) : 0,
      handsFree: automatic && saved.handsFree === true,
      silenceSeconds: (SILENCE_SECONDS_OPTIONS as readonly number[]).includes(saved.silenceSeconds) ? Number(saved.silenceSeconds) : DEFAULT_SILENCE_SECONDS,
    }
  } catch { return { automatic: false, seconds: 0, handsFree: false, silenceSeconds: DEFAULT_SILENCE_SECONDS } }
}

export function useInterviewMicSettings(ownerId: string) {
  const key = `${PRODUCT_NAME}:interview-microphone:${ownerId}`
  const [settings, setSettings] = useState(() => loadMicSettings(key))
  return { ...settings, update: (next: Partial<MicSettings>) => {
    const value = { ...settings, ...next }
    if (next.handsFree) value.automatic = true
    if (!value.automatic) { value.seconds = 0; value.handsFree = false }
    setSettings(value)
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Applies to this room even without storage. */ }
  } }
}
