/**
 * Description: Shared alert with manual dismissal and an automatic timeout.
 * Index:
 *   - TRANSIENT_ALERT_MS: default visibility duration
 *   - TRANSIENT_ALERT_EXIT_MS: how long the fade-out plays before the alert unmounts
 *   - TransientAlert: dismissible shadcn alert
 */
import { useEffect, useState, type ComponentProps } from 'react'
import { X } from 'lucide-react'
import { Alert, AlertAction } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const TRANSIENT_ALERT_MS = 8000
export const TRANSIENT_ALERT_EXIT_MS = 150

/** Shows an alert briefly, fading in and out; use a new key for a new notification. */
export function TransientAlert({ children, className, ...props }: ComponentProps<typeof Alert>) {
  const [phase, setPhase] = useState<'shown' | 'leaving' | 'gone'>('shown')
  const dismiss = () => setPhase((current) => (current === 'shown' ? 'leaving' : current))
  useEffect(() => {
    const timer = window.setTimeout(() => setPhase('leaving'), TRANSIENT_ALERT_MS)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(() => setPhase('gone'), TRANSIENT_ALERT_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [phase])
  if (phase === 'gone') return null
  return <Alert {...props} className={cn('transient-alert', className)} data-state={phase === 'shown' ? 'open' : 'closed'}>
    {children}
    <AlertAction>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" disabled={phase === 'leaving'} onClick={dismiss}><X /></Button>
    </AlertAction>
  </Alert>
}
