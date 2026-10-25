/** A small persistent notice stack for every successful or failed AI task.
 * Notices never navigate or take focus automatically, and remain until dismissed. */
import { Link } from 'react-router'
import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useTaskNotifications } from './useTaskNotifications'

export function TaskNotifications({ userId, initialCursor }: { userId: string; initialCursor?: string | null }) {
  const { notices, dismiss } = useTaskNotifications(userId, initialCursor)
  if (notices.length === 0) return null
  return <aside aria-label="Task notifications" className="fixed right-4 bottom-4 z-50 grid max-h-[70svh] w-[min(24rem,calc(100vw-2rem))] gap-3 overflow-y-auto">
    {notices.map((notice) => {
      const failed = notice.status === 'FAILED'
      const Icon = failed ? CircleAlert : CheckCircle2
      return <Alert key={notice.id} role={failed ? 'alert' : 'status'} variant={failed ? 'destructive' : 'default'} className="shadow-md">
        <Icon aria-hidden />
        <AlertTitle>{notice.title}</AlertTitle>
        <AlertDescription>
          <Link to={notice.destination} onClick={() => dismiss(notice.id)}>{failed ? 'Review task' : 'View result'}</Link>
        </AlertDescription>
        <AlertAction>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Dismiss ${notice.title}`} onClick={() => dismiss(notice.id)}><X aria-hidden /></Button>
        </AlertAction>
      </Alert>
    })}
  </aside>
}
