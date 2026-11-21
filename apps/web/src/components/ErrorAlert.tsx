/**
 * Description: Red alert listing one or more user-facing error messages. A caller can pass an
 * `action` (for example a link) that shows after the messages; this component knows nothing about
 * what the action is for.
 * Index:
 *   - ErrorAlert: renders nothing when `messages` is empty
 */
import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TransientAlert } from './TransientAlert'

interface ErrorAlertProps {
  messages: string[]
  title?: string
  notificationId?: string
  /** Shown after the messages, such as a link to fix the problem. */
  action?: ReactNode
}

/** Shows error messages in a destructive alert, with an optional title. */
export function ErrorAlert({ messages, title, notificationId, action }: ErrorAlertProps) {
  if (messages.length === 0) return null
  const Container = notificationId ? TransientAlert : Alert
  return (
    <Container key={notificationId} variant="destructive">
      <CircleAlert />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
        {action && <p>{action}</p>}
      </AlertDescription>
    </Container>
  )
}
