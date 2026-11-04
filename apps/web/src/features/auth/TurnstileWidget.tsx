/**
 * Runs Cloudflare Turnstile on the sign-up form and hands its one-time token to the page.
 * Most people never see a prompt. Cloudflare's script loads only when this renders, and
 * the server makes the real decision; this only collects the token.
 */
import { useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY } from '@/lib/apiConfig'

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render(container: HTMLElement, options: {
    sitekey: string
    appearance: 'interaction-only'
    size: 'flexible'
    callback: (token: string) => void
    'expired-callback': () => void
    'timeout-callback': () => void
    'error-callback': () => void
  }): string
  remove(widgetId: string): void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let turnstileScript: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_URL
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not start')))
    script.onerror = () => {
      turnstileScript = null
      script.remove()
      reject(new Error('Turnstile did not load'))
    }
    document.head.appendChild(script)
  })
  return turnstileScript
}

interface TurnstileWidgetProps {
  /** Receives a token when the check passes, and null when it expires or fails. */
  onTokenChange: (token: string | null) => void
}

export function TurnstileWidget({ onTokenChange }: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'checking' | 'passed' | 'failed'>('checking')

  useEffect(() => {
    let unmounted = false
    let remove = () => {}
    const fail = () => {
      if (unmounted) return
      onTokenChange(null)
      setStatus('failed')
    }
    loadTurnstile().then((turnstile) => {
      if (unmounted || !container.current) return
      const widgetId = turnstile.render(container.current, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only',
        size: 'flexible',
        callback: (token) => {
          onTokenChange(token)
          setStatus('passed')
        },
        // Turnstile fetches a new token by itself after expiry; hold submit until it arrives.
        'expired-callback': () => {
          onTokenChange(null)
          setStatus('checking')
        },
        'timeout-callback': fail,
        'error-callback': fail,
      })
      remove = () => turnstile.remove(widgetId)
    }).catch(fail)
    return () => {
      unmounted = true
      remove()
    }
  }, [onTokenChange])

  return (
    <div className="grid gap-2">
      <div ref={container} />
      {status === 'checking' && <p className="text-sm text-muted-foreground">Running a quick security check…</p>}
      {status === 'failed' && <p role="alert" className="text-sm text-destructive">The security check didn't finish. Turn off any content blocker, then refresh this page.</p>}
    </div>
  )
}
