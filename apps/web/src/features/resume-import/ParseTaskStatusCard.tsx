/**
 * Description: Status card for a parse_resume task that isn't ready to review (still parsing,
 * failed, already imported, or waiting on the connection).
 * Index:
 *   - ParseTaskStatus: the states this card can show
 *   - ParseTaskStatusCard: icon, message, and next-step link for a status
 */
import type { ReactNode } from 'react'
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export type ParseTaskStatus = 'connecting' | 'parsing' | 'failed' | 'imported'

interface ParseTaskStatusCardProps {
  status: ParseTaskStatus
  errorMessage?: string | null
}

/** Explains where the parse is and what the user can do next. */
export function ParseTaskStatusCard({ status, errorMessage }: ParseTaskStatusCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        {status === 'connecting' && <StatusMessage icon={<Spinner />} title="Loading…" />}
        {status === 'parsing' && (
          <StatusMessage
            icon={<Spinner />}
            title="Reading your resume…"
            body="This usually takes under a minute. You can leave this page open; it updates by itself."
          />
        )}
        {status === 'failed' && (
          <>
            <StatusMessage
              icon={<CircleX className="size-10 text-destructive" />}
              title="We couldn't read that resume"
              body={errorMessage ?? 'Something went wrong while parsing.'}
            />
            <Button asChild variant="outline">
              <Link to="/library">Try another file</Link>
            </Button>
          </>
        )}
        {status === 'imported' && (
          <>
            <StatusMessage
              icon={<CircleCheck className="size-10 text-signal-done-text" />}
              title="Already imported"
              body="This resume is already in your career library."
            />
            <Button asChild>
              <Link to="/library">View career library</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Icon, title, and optional explanation, stacked. */
function StatusMessage({ icon, title, body }: { icon: ReactNode; title: string; body?: string }) {
  return (
    <>
      {icon}
      <div className="grid gap-1">
        <p className="text-lg font-medium">{title}</p>
        {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      </div>
    </>
  )
}

/** Large spinning loader icon. */
function Spinner() {
  return <LoaderCircle className="size-10 animate-spin text-muted-foreground" />
}
