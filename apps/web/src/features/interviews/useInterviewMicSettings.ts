/** Remember microphone preferences for this account without saving any answer content. */
import { useState } from 'react'
import { PRODUCT_NAME } from '@/lib/productName'

export function useInterviewMicSettings(ownerId: string) {
  const key = `${PRODUCT_NAME}:interview-microphone:${ownerId}`
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
      return { automatic: saved.automatic === true, seconds: saved.automatic === true ? ([0, 3, 5, 10].includes(saved.seconds) ? Number(saved.seconds) : 5) : 0 }
    } catch { return { automatic: false, seconds: 0 } }
  })
  return { ...settings, update: (next: Partial<typeof settings>) => {
    const value = { ...settings, ...next }
    if (!value.automatic) value.seconds = 0
    setSettings(value)
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Applies to this room even without storage. */ }
  } }
}
