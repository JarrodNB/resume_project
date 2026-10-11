/**
 * Description: Red alert listing one or more user-facing error messages.
 * Index:
 *   - ErrorAlert: renders nothing when `messages` is empty
 */
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TransientAlert } from './TransientAlert'

interface ErrorAlertProps {
  messages: string[]
  title?: string
  notificationId?: string
}

/** Shows error messages in a destructive alert, with an optional title. */
export function ErrorAlert({ messages, title, notificationId }: ErrorAlertProps) {
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
      </AlertDescription>
    </Container>
  )
}
