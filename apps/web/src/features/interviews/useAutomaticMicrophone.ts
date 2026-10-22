/** Open the mic once per question after a quiet thinking pause.
 * Playback and settings pause the countdown. Typing or starting a recording cancels
 * this question's automatic start; returning to the tab never repeats a capture.
 */
import { useEffect, useRef, useState } from 'react'

interface Options {
  promptId: string | undefined
  enabled: boolean
  seconds: number
  paused: boolean
  answered: boolean
  start: () => void
}

export function useAutomaticMicrophone({ promptId, enabled, seconds, paused, answered, start }: Options) {
  const previousPrompt = useRef(promptId)
  const consumed = useRef(new Set<string>())
  const startRef = useRef(start)
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => { startRef.current = start }, [start])
  useEffect(() => {
    const changed = previousPrompt.current !== promptId
    previousPrompt.current = promptId
    // A saved new question may render once before the previous capture resets.
    if (promptId && answered && !changed) consumed.current.add(promptId)
    if (!promptId || !enabled || paused || answered || consumed.current.has(promptId)) {
      // Clear a suspended timer without retaining an obsolete countdown on screen.
      // oxlint-disable-next-line react/set-state-in-effect
      setRemaining(null)
      return
    }
    let left = seconds
    // Let automatic playback dispatch before deciding the room is quiet.
    const settle = setTimeout(() => {
      setRemaining(left)
      if (left === 0) open()
      else interval = setInterval(() => {
        left -= 1
        setRemaining(left)
        if (left === 0) open()
      }, 1000)
    }, 400)
    let interval: ReturnType<typeof setInterval> | undefined
    function open() {
      clearInterval(interval)
      consumed.current.add(promptId!)
      setRemaining(null)
      startRef.current()
    }
    return () => { clearTimeout(settle); clearInterval(interval) }
  }, [promptId, enabled, seconds, paused, answered])
  return remaining
}
