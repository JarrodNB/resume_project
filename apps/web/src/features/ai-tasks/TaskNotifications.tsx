/** Keeps task outcomes in the workspace header, ready to review without interrupting work.
 * Opening the inbox marks its count as read; results stay available until opened or dismissed.
 * New outcomes are announced without opening the panel or moving keyboard focus. */
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Bell, CheckCircle2, CircleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useTaskNotifications } from './useTaskNotifications'

export function TaskNotifications({ userId, initialCursor }: { userId: string; initialCursor?: string | null }) {
  const { notices, dismiss } = useTaskNotifications(userId, initialCursor)
  const contentRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const unread = open ? 0 : notices.filter((notice) => !readIds.has(notice.id)).length
  function changeOpen(next: boolean) {
    setReadIds(new Set(notices.map((notice) => notice.id)))
    setOpen(next)
  }

  return <>
    <div className="sr-only" role="status" aria-relevant="additions" aria-atomic="false">
      {notices.filter((notice) => notice.status !== 'FAILED').map((notice) => <p key={notice.id}>New notification: {notice.title}</p>)}
    </div>
    <div className="sr-only" role="alert" aria-relevant="additions" aria-atomic="false">
      {notices.filter((notice) => notice.status === 'FAILED').map((notice) => <p key={notice.id}>New notification: {notice.title}</p>)}
    </div>
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="relative size-11 shrink-0 text-foreground" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell className="size-[19px]" strokeWidth={1.7} aria-hidden />
          {unread > 0 && <span aria-hidden className="absolute top-0.5 right-0 flex min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-[18px] font-semibold text-primary-foreground tabular-nums">{unread > 99 ? '99+' : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent ref={contentRef} align="end" sideOffset={10} collisionPadding={16} className="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-xl p-0" aria-label="Task notifications">
        <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight">Notifications</h2>
          <span className="text-xs text-muted-foreground">{notices.length} {notices.length === 1 ? 'update' : 'updates'}</span>
        </div>
        {notices.length === 0 ? <div className="px-5 py-8">
          <p className="text-sm font-medium">You’re all caught up</p>
          <p className="mt-1 max-w-[30ch] text-sm leading-relaxed text-muted-foreground">When an AI task finishes, its result will appear here.</p>
        </div> : <ul className="max-h-[min(28rem,60svh)] divide-y divide-border overflow-y-auto overscroll-contain">
          {[...notices].reverse().map((notice) => {
            const failed = notice.status === 'FAILED'
            const Icon = failed ? CircleAlert : CheckCircle2
            return <li key={notice.id} className="flex items-start gap-1 pl-5 pr-2">
              <Link to={notice.destination} onClick={() => { changeOpen(false); dismiss(notice.id) }} className="group flex min-w-0 flex-1 items-start gap-3 rounded-md py-4 outline-offset-2 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
                <Icon className={cn('mt-0.5 size-[18px] shrink-0', failed ? 'text-destructive' : 'text-primary')} strokeWidth={1.7} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm leading-snug font-medium wrap-anywhere">{notice.title}</span>
                  {' '}<span className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary">{failed ? 'Review task' : 'View result'}<ArrowUpRight className="size-3.5" aria-hidden /></span>
                </span>
              </Link>
              <Button type="button" variant="ghost" size="icon" className="mt-2 size-11 shrink-0 text-muted-foreground" aria-label={`Dismiss ${notice.title}`} onClick={() => { dismiss(notice.id); contentRef.current?.focus() }}><X className="size-4" aria-hidden /></Button>
            </li>
          })}
        </ul>}
      </PopoverContent>
    </Popover>
  </>
}
