/**
 * Description: Red alert listing one or more user-facing error messages.
 * Index:
 *   - ErrorAlert: renders nothing when `messages` is empty
 */
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface ErrorAlertProps {
  messages: string[]
  title?: string
}

/** Shows error messages in a destructive alert, with an optional title. */
export function ErrorAlert({ messages, title }: ErrorAlertProps) {
  if (messages.length === 0) return null
  return (
    <Alert variant="destructive">
      <CircleAlert />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </AlertDescription>
    </Alert>
  )
}
