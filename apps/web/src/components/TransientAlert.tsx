/**
 * Description: Shared alert with manual dismissal and an automatic timeout.
 * Index:
 *   - TRANSIENT_ALERT_MS: default visibility duration
 *   - TransientAlert: dismissible shadcn alert
 */
import { useEffect, useState, type ComponentProps } from 'react'
import { X } from 'lucide-react'
import { Alert, AlertAction } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export const TRANSIENT_ALERT_MS = 8000

/** Shows an alert briefly; use a new key for a new notification. */
export function TransientAlert({ children, ...props }: ComponentProps<typeof Alert>) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), TRANSIENT_ALERT_MS)
    return () => window.clearTimeout(timer)
  }, [])
  if (!visible) return null
  return <Alert {...props}>
    {children}
    <AlertAction>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setVisible(false)}><X /></Button>
    </AlertAction>
  </Alert>
}
