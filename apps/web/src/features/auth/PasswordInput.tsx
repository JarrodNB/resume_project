/** Keeps password visibility local to the input while preserving password-manager behavior. */
import { useState, type ComponentProps } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** A controlled password input with a keyboard-accessible visibility toggle. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('min-h-11 min-w-0 flex-1', className)} />
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        aria-controls={props.id}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? 'Hide' : 'Show'}
      </Button>
    </div>
  )
}
